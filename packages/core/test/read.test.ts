import { readFileSync } from 'node:fs';
import type { Address, Hash, Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  callsOf,
  callStatus,
  deserializeEvents,
  describeFeed,
  fetchEvents,
  memoryStore,
  publisherStats,
  resolveRevealers,
  scorecardOf,
  serializeEvents,
  syncEvents,
  targetOf,
  verifierWallets,
  type LogClient,
  type NetworkInfo,
  type PocEvent,
} from '../src/index.js';

interface Fixture {
  contract: Address;
  deployBlock: string;
  headBlock: string;
  now: string;
  publisher: Address;
  verifier: Address;
  feeds: { BTC: Address; ETH: Address };
  revealers: Record<string, Address>;
  events: unknown[];
}

const fixture = JSON.parse(
  readFileSync(new URL('fixtures/local-anvil-events.json', import.meta.url), 'utf8'),
) as Fixture;
const events = deserializeEvents(fixture.events);
const NOW = BigInt(fixture.now);
const HEAD = BigInt(fixture.headBlock);

const network: NetworkInfo = {
  key: 'local',
  chainId: 31337,
  name: 'Local anvil',
  rpcUrls: ['http://127.0.0.1:8545'],
  explorer: null,
  proofOfCall: { address: fixture.contract, deployBlock: BigInt(fixture.deployBlock), deployTx: null },
  feeds: [
    { asset: 'BTC', pair: 'BTC / USD', address: fixture.feeds.BTC, decimals: 8, kind: 'mock' },
    { asset: 'ETH', pair: 'ETH / USD', address: fixture.feeds.ETH, decimals: 8, kind: 'mock' },
  ],
  feedsVerified: true,
};

const txClient = {
  getTransaction: ({ hash }: { hash: Hash }) => {
    const from = fixture.revealers[hash.toLowerCase()];
    if (!from) return Promise.reject(new Error(`unknown tx ${hash}`));
    return Promise.resolve({ from });
  },
} as unknown as Parameters<typeof resolveRevealers>[0];

/** An RPC that serves the fixture's logs, with a block-range limit and scripted failures. */
function fakeRpc(opts: { maxRange?: bigint; fail?: number; head?: bigint } = {}) {
  const ranges: [bigint, bigint][] = [];
  let fail = opts.fail ?? 0;
  const client = {
    getBlockNumber: () => Promise.resolve(opts.head ?? HEAD),
    getLogs: ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      if (opts.maxRange !== undefined && toBlock - fromBlock + 1n > opts.maxRange) {
        return Promise.reject(new Error('query exceeds max block range'));
      }
      if (fail > 0) {
        fail--;
        return Promise.reject(new Error('upstream timeout'));
      }
      const logs = events
        .filter((e) => e.block >= fromBlock && e.block <= toBlock)
        .map((e) => {
          const { kind, block, logIndex, tx, ...args } = e;
          return { eventName: kind, args, blockNumber: block, logIndex, transactionHash: tx };
        });
      return Promise.resolve(logs);
    },
  };
  return { client: client as unknown as LogClient, ranges };
}

const noSleep = () => Promise.resolve();

describe('call index from the recorded events', () => {
  const index = buildIndex(events);

  it('folds every event into one record per call', () => {
    expect(index.anomalies).toEqual([]);
    expect(index.calls.size).toBe(5);
    const byLabel = Object.fromEntries([...index.calls.values()].map((c) => [c.label ?? c.callId, callStatus(c, NOW)]));
    expect(byLabel).toEqual({
      'RC-0001': 'HIT',
      'RC-0002': 'MISS',
      'RC-0003': 'FLAT',
      'RC-0004': 'VOID',
      'RC-0005': 'EXPIRED',
    });
  });

  it('computes the scorecard with the contract semantics (expiries count as misses)', () => {
    expect(scorecardOf(index, fixture.publisher)).toEqual({
      sealedCalls: 5n,
      hits: 1n,
      misses: 2n,
      flats: 1n,
      voids: 1n,
      expiries: 1n,
    });
    expect(scorecardOf(index, fixture.verifier).sealedCalls).toBe(0n);
    const [stats] = publisherStats(index);
    expect(stats?.publisher).toBe(fixture.publisher);
    expect(stats?.hitRate).toBeCloseTo(1 / 3);
    expect(stats?.open).toBe(0);
    expect(callsOf(index, fixture.publisher)).toHaveLength(5);
  });

  it('finds the verifier wallets through the reveal transactions', async () => {
    const fresh = buildIndex(events);
    expect(verifierWallets(fresh)).toEqual([{ address: fixture.verifier, reveals: 0, expiries: 1 }]);
    const known = new Map<string, Address>();
    await resolveRevealers(txClient, fresh, known);
    expect(verifierWallets(fresh)).toEqual([{ address: fixture.verifier, reveals: 1, expiries: 1 }]);
    expect(known.size).toBe(4);
    const flat = [...fresh.calls.values()].find((c) => c.label === 'RC-0003');
    expect(flat?.revealed?.revealer).toBe(fixture.verifier);
  });

  it('labels feeds and flags unknown ones', () => {
    const hit = [...index.calls.values()].find((c) => c.label === 'RC-0001');
    if (!hit?.revealed) throw new Error('fixture changed');
    expect(describeFeed(network, hit.revealed.feed)).toEqual({ asset: 'BTC', pair: 'BTC / USD', known: true });
    expect(describeFeed(network, '0x0000000000000000000000000000000000000bad')).toMatchObject({
      asset: null,
      known: false,
    });
  });

  it('derives the live status of an open call from chain time', () => {
    const sealed = events.find((e) => e.kind === 'Sealed');
    if (sealed?.kind !== 'Sealed') throw new Error('fixture changed');
    const [open] = buildIndex([sealed]).calls.values();
    if (!open) throw new Error('unreachable');
    expect(callStatus(open, sealed.sealedAt)).toBe('WAITING');
    expect(callStatus(open, targetOf(open))).toBe('REVEALABLE');
    expect(callStatus(open, open.sealed.revealBy)).toBe('REVEALABLE');
    expect(callStatus(open, open.sealed.revealBy + 1n)).toBe('EXPIRABLE');
  });

  it('reports events that do not fit instead of hiding them', () => {
    const [s, r] = [events.find((e) => e.kind === 'Sealed'), events.find((e) => e.kind === 'Revealed')] as [
      PocEvent,
      PocEvent,
    ];
    const odd = buildIndex([r, s, s, { ...r, block: r.block + 100n }]);
    expect(odd.anomalies).toHaveLength(2);
    expect(odd.anomalies[0]).toMatch(/second Sealed/);
    expect(odd.anomalies[1]).toMatch(/already settled/);
    expect(buildIndex([r]).anomalies[0]).toMatch(/without Sealed/);
  });
});

describe('serialisation', () => {
  it('round-trips events through JSON', () => {
    expect(deserializeEvents(JSON.parse(JSON.stringify(serializeEvents(events))) as unknown[])).toEqual(events);
  });

  it('rejects malformed cached data', () => {
    expect(() => deserializeEvents([{ kind: 'Nope' }])).toThrow(/unknown kind/);
    expect(() => deserializeEvents([{ kind: 'Sealed', block: 'x' }])).toThrow(/bad block/);
    expect(() => deserializeEvents([null])).toThrow(/not an object/);
  });
});

describe('fetchEvents', () => {
  const from = BigInt(fixture.deployBlock);

  it('covers the range exactly once and returns sorted events', async () => {
    const { client, ranges } = fakeRpc();
    const progress: bigint[] = [];
    const got = await fetchEvents(client, fixture.contract, {
      fromBlock: from,
      toBlock: HEAD,
      chunkSize: 4n,
      onProgress: (d) => progress.push(d),
    });
    expect(got).toEqual(events);
    expect(ranges[0]?.[0]).toBe(from);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]?.[0]).toBe((ranges[i - 1]?.[1] ?? 0n) + 1n);
    expect(ranges.at(-1)?.[1]).toBe(HEAD);
    expect(progress.at(-1)).toBe(HEAD);
  });

  it('halves the range when the RPC refuses it, then grows back', async () => {
    const { client, ranges } = fakeRpc({ maxRange: 5n });
    const got = await fetchEvents(client, fixture.contract, {
      fromBlock: from,
      toBlock: HEAD,
      chunkSize: 16n,
      minChunkSize: 2n,
      sleep: noSleep,
    });
    expect(got).toEqual(events);
    expect(ranges.some(([a, b]) => b - a + 1n === 16n)).toBe(true);
    expect(ranges.some(([a, b]) => b - a + 1n <= 5n)).toBe(true);
  });

  it('retries transient errors with backoff and gives up after the retry budget', async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const flaky = fakeRpc({ fail: 2 });
    await expect(
      fetchEvents(flaky.client, fixture.contract, {
        fromBlock: from,
        toBlock: HEAD,
        chunkSize: 2n,
        minChunkSize: 2n,
        sleep,
      }),
    ).resolves.toEqual(events);
    expect(waits).toEqual([250, 500]);
    const dead = fakeRpc({ fail: 100 });
    await expect(
      fetchEvents(dead.client, fixture.contract, {
        fromBlock: from,
        toBlock: HEAD,
        chunkSize: 2n,
        minChunkSize: 2n,
        retries: 2,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/eth_getLogs failed for blocks/);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchEvents(fakeRpc().client, fixture.contract, { fromBlock: from, toBlock: HEAD, signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('syncEvents (per-viewer cache)', () => {
  it('caches only blocks older than the reorg depth and fetches just the tail next time', async () => {
    const store = memoryStore();
    const first = fakeRpc();
    const a = await syncEvents(first.client, network, store, { reorgDepth: 5n });
    expect(a.events).toEqual(events);
    expect(a.cachedThrough).toBeNull();
    const second = fakeRpc();
    const b = await syncEvents(second.client, network, store, { reorgDepth: 5n });
    expect(b.events).toEqual(events);
    expect(b.cachedThrough).toBe(HEAD - 5n);
    expect(second.ranges[0]?.[0]).toBe(HEAD - 4n);
  });

  it('ignores a cache of another contract, a corrupt cache and a full storage', async () => {
    const store = memoryStore();
    await syncEvents(fakeRpc().client, network, store, { reorgDepth: 5n });
    const [key] = [...store.data.keys()];
    if (!key) throw new Error('nothing cached');
    store.data.set(key, '{not json');
    const fresh = fakeRpc();
    expect((await syncEvents(fresh.client, network, store, { reorgDepth: 5n })).cachedThrough).toBeNull();
    expect(fresh.ranges[0]?.[0]).toBe(BigInt(fixture.deployBlock));

    const other: NetworkInfo = {
      ...network,
      proofOfCall: { address: '0x0000000000000000000000000000000000000001', deployBlock: 1n, deployTx: null },
    };
    expect((await syncEvents(fakeRpc().client, other, store, { reorgDepth: 5n })).cachedThrough).toBeNull();

    const full = {
      get: () => null,
      set: () => {
        throw new Error('QuotaExceededError');
      },
    };
    await expect(syncEvents(fakeRpc().client, network, full, { reorgDepth: 5n })).resolves.toMatchObject({
      cachedThrough: null,
    });
  });

  it('refuses a network without a deployment', async () => {
    await expect(syncEvents(fakeRpc().client, { ...network, proofOfCall: null }, null)).rejects.toThrow(/not deployed/);
  });
});

// Keep the fixture honest about what it is.
it('the fixture is labelled as local chain data', () => {
  const raw = JSON.parse(readFileSync(new URL('fixtures/local-anvil-events.json', import.meta.url), 'utf8')) as {
    note: string;
    chainId: number;
  };
  expect(raw.chainId).toBe(31337);
  expect(raw.note).toMatch(/not QIE testnet or mainnet/);
  expect(typeof (events[0] as { callId: Hex }).callId).toBe('string');
});
