import type { AbiEvent, Address, Hash, Hex, PublicClient } from 'viem';
import { getAddress } from 'viem';
import { proofOfCallAbi } from './abi.js';
import { outcomeName, type OutcomeName } from './calls.js';
import { callIdToLabel } from './commitment.js';
import { feedByAddress, type Asset, type NetworkInfo } from './networks.js';

/**
 * Read layer: everything the web app shows comes straight from the chain, in the browser. No server, no database.
 * Events are fetched in chunks (QIE RPCs limit eth_getLogs ranges), decoded, cached per viewer (optional) and folded
 * into a call index from which proof pages, scorecards and verifier counts are derived.
 */

interface EventBase {
  block: bigint;
  logIndex: number;
  tx: Hash;
  publisher: Address;
  callId: Hex;
}

export interface SealedEvent extends EventBase {
  kind: 'Sealed';
  commitment: Hex;
  sealedAt: bigint;
  horizon: bigint;
  revealBy: bigint;
  maxGap: number;
  flatBandBps: number;
}

export interface RevealedEvent extends EventBase {
  kind: 'Revealed';
  feed: Address;
  direction: number;
  outcome: number;
  voidReason: number;
  entryRound: bigint;
  exitRound: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
}

export interface ExpiredEvent extends EventBase {
  kind: 'Expired';
  caller: Address;
}

export type PocEvent = SealedEvent | RevealedEvent | ExpiredEvent;

const CALL_EVENTS = proofOfCallAbi.filter(
  (
    item,
  ): item is Extract<(typeof proofOfCallAbi)[number], { type: 'event'; name: 'Sealed' | 'Revealed' | 'Expired' }> =>
    item.type === 'event' && (item.name === 'Sealed' || item.name === 'Revealed' || item.name === 'Expired'),
);

export type LogClient = Pick<PublicClient, 'getLogs' | 'getBlockNumber'>;

export interface FetchOptions {
  fromBlock: bigint;
  toBlock: bigint;
  /** Largest eth_getLogs range to ask for (default 5000 blocks). Halved on errors, grown back on success. */
  chunkSize?: bigint;
  minChunkSize?: bigint;
  /** Attempts at the minimum chunk size before giving up (default 4, with backoff). */
  retries?: number;
  onProgress?: (doneThrough: bigint, toBlock: bigint) => void;
  signal?: AbortSignal;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fetches and decodes Sealed / Revealed / Expired in [fromBlock, toBlock], adapting the range to the RPC. */
export async function fetchEvents(client: LogClient, contract: Address, opts: FetchOptions): Promise<PocEvent[]> {
  const max = opts.chunkSize ?? 5000n;
  const requestedMin = opts.minChunkSize ?? 50n;
  const min = requestedMin < max ? requestedMin : max;
  const retries = opts.retries ?? 4;
  const sleep = opts.sleep ?? defaultSleep;
  const out: PocEvent[] = [];
  let size = max;
  let from = opts.fromBlock;
  let failures = 0;
  while (from <= opts.toBlock) {
    opts.signal?.throwIfAborted();
    const to = from + size - 1n < opts.toBlock ? from + size - 1n : opts.toBlock;
    try {
      const logs = await client.getLogs({
        address: contract,
        events: CALL_EVENTS as unknown as AbiEvent[],
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      for (const log of logs) {
        const decoded = decodeLog(log as unknown as RawDecodedLog);
        if (decoded) out.push(decoded);
      }
      opts.onProgress?.(to, opts.toBlock);
      from = to + 1n;
      failures = 0;
      if (size < max) size = size * 2n > max ? max : size * 2n;
    } catch (err) {
      opts.signal?.throwIfAborted();
      if (size > min) {
        size = size / 2n > min ? size / 2n : min; // most RPC errors here are range or response-size limits
        continue;
      }
      failures++;
      if (failures > retries) {
        throw new Error(
          `eth_getLogs failed for blocks ${from}-${to}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      await sleep(250 * 2 ** (failures - 1));
    }
  }
  return sortEvents(out);
}

interface RawDecodedLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hash | null;
}

function decodeLog(log: RawDecodedLog): PocEvent | null {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null || !log.args) return null;
  const a = log.args;
  const base = {
    block: log.blockNumber,
    logIndex: log.logIndex,
    tx: log.transactionHash,
    publisher: getAddress(a.publisher as string),
    callId: (a.callId as string).toLowerCase() as Hex,
  };
  switch (log.eventName) {
    case 'Sealed':
      return {
        kind: 'Sealed',
        ...base,
        commitment: a.commitment as Hex,
        sealedAt: a.sealedAt as bigint,
        horizon: a.horizon as bigint,
        revealBy: a.revealBy as bigint,
        maxGap: Number(a.maxGap),
        flatBandBps: Number(a.flatBandBps),
      };
    case 'Revealed':
      return {
        kind: 'Revealed',
        ...base,
        feed: getAddress(a.feed as string),
        direction: Number(a.direction),
        outcome: Number(a.outcome),
        voidReason: Number(a.voidReason),
        entryRound: a.entryRound as bigint,
        exitRound: a.exitRound as bigint,
        entryPrice: a.entryPrice as bigint,
        exitPrice: a.exitPrice as bigint,
      };
    case 'Expired':
      return { kind: 'Expired', ...base, caller: getAddress(a.caller as string) };
    default:
      return null;
  }
}

export function sortEvents(events: readonly PocEvent[]): PocEvent[] {
  return [...events].sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Per-viewer cache (localStorage in the browser). It only ever holds events old enough not to be reorged away.
// ---------------------------------------------------------------------------------------------------------------

export interface SnapshotStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function memoryStore(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

interface Snapshot {
  v: 1;
  chainId: number;
  contract: string;
  toBlock: string;
  events: unknown[];
}

const BIGINT_FIELDS = [
  'block',
  'sealedAt',
  'horizon',
  'revealBy',
  'entryRound',
  'exitRound',
  'entryPrice',
  'exitPrice',
] as const;

export function serializeEvents(events: readonly PocEvent[]): unknown[] {
  return events.map((e) => {
    const copy: Record<string, unknown> = { ...e };
    for (const f of BIGINT_FIELDS) {
      const v = copy[f];
      if (typeof v === 'bigint') copy[f] = v.toString();
    }
    return copy;
  });
}

export function deserializeEvents(raw: readonly unknown[]): PocEvent[] {
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`event ${i}: not an object`);
    const e = { ...(item as Record<string, unknown>) };
    if (e.kind !== 'Sealed' && e.kind !== 'Revealed' && e.kind !== 'Expired')
      throw new Error(`event ${i}: unknown kind`);
    for (const f of BIGINT_FIELDS) {
      if (e[f] !== undefined) {
        if (typeof e[f] !== 'string' || !/^-?\d+$/.test(e[f])) throw new Error(`event ${i}: bad ${f}`);
        e[f] = BigInt(e[f]);
      }
    }
    return e as unknown as PocEvent;
  });
}

export interface SyncOptions {
  /** Blocks behind the head that may still be reorganised: never cached (default 15). */
  reorgDepth?: bigint;
  chunkSize?: bigint;
  onProgress?: (doneThrough: bigint, toBlock: bigint) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
  events: PocEvent[];
  headBlock: bigint;
  /** Blocks served from the cache instead of the RPC. */
  cachedThrough: bigint | null;
}

/** All call events of the network's ProofOfCall, from the deploy block to the head, using and refreshing the cache. */
export async function syncEvents(
  client: LogClient,
  network: NetworkInfo,
  store: SnapshotStore | null,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const deployment = network.proofOfCall;
  if (!deployment) throw new Error(`ProofOfCall is not deployed on ${network.name}`);
  const key = `poc:events:${network.chainId}:${deployment.address.toLowerCase()}`;
  const reorgDepth = opts.reorgDepth ?? 15n;
  // cacheTime 0: viem caches the block number for a few seconds, which would hide the newest events after a tx.
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const stable = head - reorgDepth; // older blocks can no longer be reorganised away

  let cached: PocEvent[] = [];
  let cachedThrough: bigint | null = null;
  const text = store?.get(key) ?? null;
  if (text) {
    try {
      const snap = JSON.parse(text) as Partial<Record<keyof Snapshot, unknown>>;
      const through = typeof snap.toBlock === 'string' ? BigInt(snap.toBlock) : -1n;
      if (
        snap.v === 1 &&
        snap.chainId === network.chainId &&
        snap.contract === deployment.address.toLowerCase() &&
        Array.isArray(snap.events) &&
        through >= deployment.deployBlock &&
        through <= stable
      ) {
        cached = deserializeEvents(snap.events);
        cachedThrough = through;
      }
    } catch {
      // unreadable cache: start over
    }
  }

  const from = cachedThrough === null ? deployment.deployBlock : cachedThrough + 1n;
  const fresh =
    from <= head
      ? await fetchEvents(client, deployment.address, {
          fromBlock: from,
          toBlock: head,
          ...(opts.chunkSize === undefined ? {} : { chunkSize: opts.chunkSize }),
          ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
          ...(opts.signal === undefined ? {} : { signal: opts.signal }),
          ...(opts.sleep === undefined ? {} : { sleep: opts.sleep }),
        })
      : [];
  const events = sortEvents([...cached, ...fresh]);

  if (store && stable >= deployment.deployBlock) {
    const snapshot: Snapshot = {
      v: 1,
      chainId: network.chainId,
      contract: deployment.address.toLowerCase(),
      toBlock: stable.toString(),
      events: serializeEvents(events.filter((e) => e.block <= stable)),
    };
    try {
      store.set(key, JSON.stringify(snapshot));
    } catch {
      // storage full or blocked: the cache is only a convenience
    }
  }
  return { events, headBlock: head, cachedThrough };
}

// ---------------------------------------------------------------------------------------------------------------
// Call index
// ---------------------------------------------------------------------------------------------------------------

export interface CallRecord {
  key: string;
  publisher: Address;
  callId: Hex;
  label: string | null;
  sealed: SealedEvent;
  revealed: (RevealedEvent & { revealer: Address | null }) | null;
  expired: ExpiredEvent | null;
}

export interface CallIndex {
  calls: Map<string, CallRecord>;
  /** Events that do not fit (should never happen with a correct RPC); shown, not hidden. */
  anomalies: string[];
}

export function callKey(publisher: Address, callId: Hex): string {
  return `${publisher.toLowerCase()}:${callId.toLowerCase()}`;
}

export function buildIndex(events: readonly PocEvent[]): CallIndex {
  const calls = new Map<string, CallRecord>();
  const anomalies: string[] = [];
  for (const e of sortEvents(events)) {
    const key = callKey(e.publisher, e.callId);
    const existing = calls.get(key);
    if (e.kind === 'Sealed') {
      if (existing) anomalies.push(`second Sealed for ${key} in tx ${e.tx}`);
      else
        calls.set(key, {
          key,
          publisher: e.publisher,
          callId: e.callId,
          label: callIdToLabel(e.callId),
          sealed: e,
          revealed: null,
          expired: null,
        });
      continue;
    }
    if (!existing) {
      anomalies.push(`${e.kind} without Sealed for ${key} in tx ${e.tx}`);
      continue;
    }
    if (existing.revealed || existing.expired) {
      anomalies.push(`${e.kind} for an already settled call ${key} in tx ${e.tx}`);
      continue;
    }
    if (e.kind === 'Revealed') existing.revealed = { ...e, revealer: null };
    else existing.expired = e;
  }
  return { calls, anomalies };
}

export type CallStatus = 'WAITING' | 'REVEALABLE' | 'EXPIRABLE' | Exclude<OutcomeName, 'OPEN'>;

/** Live status at chain time `now` (seconds). */
export function callStatus(call: CallRecord, now: bigint): CallStatus {
  if (call.revealed) return outcomeName(call.revealed.outcome) as CallStatus;
  if (call.expired) return 'EXPIRED';
  const target = call.sealed.sealedAt + call.sealed.horizon;
  if (now < target) return 'WAITING';
  if (now <= call.sealed.revealBy) return 'REVEALABLE';
  return 'EXPIRABLE';
}

export function targetOf(call: CallRecord): bigint {
  return call.sealed.sealedAt + call.sealed.horizon;
}

/** ProofOfCall.Scorecard semantics: misses include expiries. */
export interface Scorecard {
  sealedCalls: bigint;
  hits: bigint;
  misses: bigint;
  flats: bigint;
  voids: bigint;
  expiries: bigint;
}

export function scorecardOf(index: CallIndex, publisher: Address): Scorecard {
  const card: Scorecard = { sealedCalls: 0n, hits: 0n, misses: 0n, flats: 0n, voids: 0n, expiries: 0n };
  const p = publisher.toLowerCase();
  for (const c of index.calls.values()) {
    if (c.publisher.toLowerCase() !== p) continue;
    card.sealedCalls++;
    if (c.expired) {
      card.misses++;
      card.expiries++;
    } else if (c.revealed) {
      const o = outcomeName(c.revealed.outcome);
      if (o === 'HIT') card.hits++;
      else if (o === 'MISS') card.misses++;
      else if (o === 'FLAT') card.flats++;
      else if (o === 'VOID') card.voids++;
    }
  }
  return card;
}

export async function readScorecard(
  client: Pick<PublicClient, 'readContract'>,
  contract: Address,
  publisher: Address,
): Promise<Scorecard> {
  const s = await client.readContract({
    address: contract,
    abi: proofOfCallAbi,
    functionName: 'scorecard',
    args: [publisher],
  });
  return {
    sealedCalls: s.sealedCalls,
    hits: s.hits,
    misses: s.misses,
    flats: s.flats,
    voids: s.voids,
    expiries: s.expiries,
  };
}

export function sameScorecard(a: Scorecard, b: Scorecard): boolean {
  return (
    a.sealedCalls === b.sealedCalls &&
    a.hits === b.hits &&
    a.misses === b.misses &&
    a.flats === b.flats &&
    a.voids === b.voids &&
    a.expiries === b.expiries
  );
}

export interface PublisherStats {
  publisher: Address;
  card: Scorecard;
  open: number;
  /** hits / (hits + misses); FLAT and VOID calls are not decided. null until something is decided. */
  hitRate: number | null;
  lastSealedAt: bigint;
}

export function publisherStats(index: CallIndex): PublisherStats[] {
  const by = new Map<string, Address>();
  for (const c of index.calls.values()) by.set(c.publisher.toLowerCase(), c.publisher);
  return [...by.values()]
    .map((publisher) => {
      const card = scorecardOf(index, publisher);
      const mine = [...index.calls.values()].filter((c) => c.publisher.toLowerCase() === publisher.toLowerCase());
      const decided = card.hits + card.misses;
      return {
        publisher,
        card,
        open: mine.filter((c) => !c.revealed && !c.expired).length,
        hitRate: decided === 0n ? null : Number(card.hits) / Number(decided),
        lastSealedAt: mine.reduce((m, c) => (c.sealed.sealedAt > m ? c.sealed.sealedAt : m), 0n),
      };
    })
    .sort((a, b) =>
      a.card.sealedCalls === b.card.sealedCalls
        ? a.lastSealedAt > b.lastSealedAt
          ? -1
          : 1
        : a.card.sealedCalls > b.card.sealedCalls
          ? -1
          : 1,
    );
}

export function callsOf(index: CallIndex, publisher: Address): CallRecord[] {
  const p = publisher.toLowerCase();
  return [...index.calls.values()]
    .filter((c) => c.publisher.toLowerCase() === p)
    .sort((a, b) => (a.sealed.sealedAt > b.sealed.sealedAt ? -1 : 1));
}

/**
 * Who sent each reveal (the Revealed event does not carry the sender): one getTransaction per reveal, memoised in
 * `known` (transaction senders never change).
 */
export async function resolveRevealers(
  client: Pick<PublicClient, 'getTransaction'>,
  index: CallIndex,
  known: Map<string, Address> = new Map(),
): Promise<void> {
  for (const c of index.calls.values()) {
    if (!c.revealed || c.revealed.revealer) continue;
    const hash = c.revealed.tx.toLowerCase();
    let from = known.get(hash);
    if (!from) {
      from = getAddress((await client.getTransaction({ hash: c.revealed.tx })).from);
      known.set(hash, from);
    }
    c.revealed.revealer = from;
  }
}

export interface Verifier {
  address: Address;
  reveals: number;
  expiries: number;
}

/** Verifier wallets: anyone other than a call's publisher who revealed (via a shared link) or expired it. */
export function verifierWallets(index: CallIndex): Verifier[] {
  const by = new Map<string, Verifier>();
  const bump = (address: Address, field: 'reveals' | 'expiries') => {
    const k = address.toLowerCase();
    const v = by.get(k) ?? { address, reveals: 0, expiries: 0 };
    v[field]++;
    by.set(k, v);
  };
  for (const c of index.calls.values()) {
    const p = c.publisher.toLowerCase();
    if (c.revealed?.revealer && c.revealed.revealer.toLowerCase() !== p) bump(c.revealed.revealer, 'reveals');
    if (c.expired && c.expired.caller.toLowerCase() !== p) bump(c.expired.caller, 'expiries');
  }
  return [...by.values()].sort((a, b) => b.reveals + b.expiries - (a.reveals + a.expiries));
}

export interface FeedLabel {
  asset: Asset | null;
  pair: string;
  /** The feed is one this app knows for the network (QIE Oracle on mainnet, our mocks on testnet). */
  known: boolean;
}

/** Label for a revealed call's feed. Unknown feeds on mainnet are flagged (threat model T12). */
export function describeFeed(network: NetworkInfo, feed: Address): FeedLabel {
  const f = feedByAddress(network, feed);
  return f
    ? { asset: f.asset, pair: f.pair, known: true }
    : { asset: null, pair: `unknown feed ${feed}`, known: false };
}
