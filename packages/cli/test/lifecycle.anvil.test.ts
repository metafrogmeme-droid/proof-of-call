import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildIndex,
  callStatus,
  computeCommitment,
  memoryStore,
  readScorecard,
  resolveRevealers,
  scorecardOf,
  serializeEvents,
  syncEvents,
  verifierWallets,
  labelToCallId,
  openingMatches,
  parseCallRoute,
  parseOpeningJson,
  parsePrice,
  proofOfCallAbi,
  UP,
  DOWN,
} from '@proof-of-call/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { openNetwork, type Ctx } from '../src/context.js';
import { expire } from '../src/commands/expire.js';
import { info } from '../src/commands/info.js';
import { list } from '../src/commands/list.js';
import { mockPush } from '../src/commands/mockPush.js';
import { reveal } from '../src/commands/reveal.js';
import { seal, type SealOptions } from '../src/commands/seal.js';
import { exportOpening, share } from '../src/commands/share.js';
import { UnlockedSigner } from '../src/signers/unlocked.js';
import type { Signer } from '../src/signers/types.js';
import { Vault } from '../src/vault.js';
import { deployLocal, startAnvil, type Anvil, type LocalDeployment } from './helpers/anvil.js';
import { testIo } from './helpers/io.js';

const H = 3600;
const MAX_GAP = 6 * H;

describe('publisher CLI against a local chain (anvil)', () => {
  let anvil: Anvil;
  let dep: LocalDeployment;
  let ctx: Ctx;
  let vault: Vault;
  let signer: Signer;
  let admin: Address;
  let publisher: Address;
  let verifier: Address;
  const io = testIo({ confirm: true });

  const sealOpts = (over: Partial<SealOptions>): SealOptions => ({
    asset: 'BTC',
    direction: UP,
    horizon: BigInt(4 * H),
    from: publisher,
    labelPrefix: 'RC',
    revealWindow: BigInt(24 * H),
    yes: true,
    ...over,
  });
  const push = (asset: 'BTC' | 'ETH', price: string) =>
    mockPush(ctx, signer, { asset, answer: parsePrice(price), from: admin, yes: true }, io);
  const revealFromVault = (label: string) =>
    reveal(ctx, signer, { vault }, { ref: label, from: publisher, yes: true }, io);

  beforeAll(async () => {
    anvil = await startAnvil();
    [admin = '0x', publisher = '0x', verifier = '0x'] = anvil.accounts;
    dep = await deployLocal(anvil, MAX_GAP, 10);
    ctx = await openNetwork({ network: 'local', deploymentsDir: dep.dir });
    signer = new UnlockedSigner(anvil.rpcUrl);
    vault = await Vault.create(
      join(mkdtempSync(join(tmpdir(), 'poc-life-')), 'vault.json'),
      'correct horse battery staple',
      {
        N: 2 ** 14,
        r: 8,
        p: 1,
      },
    );
  });

  afterAll(() => {
    anvil.stop();
  });

  it('computes the same commitment as the contract', async () => {
    const input = {
      chainId: 31337,
      contract: dep.poc,
      publisher,
      callId: labelToCallId('X-1'),
      feed: dep.btc,
      direction: DOWN,
      salt: `0x${'42'.repeat(32)}`,
    } as const;
    const onchain = await ctx.client.readContract({
      address: dep.poc,
      abi: proofOfCallAbi,
      functionName: 'computeCommitment',
      args: [input.publisher, input.callId, input.feed, input.direction, input.salt],
    });
    expect(computeCommitment(input)).toBe(onchain);
  });

  it('shows the network', async () => {
    await info(ctx, io);
    expect(io.lines.some((l) => l.startsWith('ProofOfCall') && l.toLowerCase().includes(dep.poc.toLowerCase()))).toBe(
      true,
    );
    expect(io.lines.some((l) => l.includes('BTC') && l.includes('no data yet'))).toBe(true);
  });

  it('seals: vault first, numbered labels, Sealed event checked', async () => {
    const a = await seal(ctx, signer, vault, sealOpts({}), io);
    const b = await seal(ctx, signer, vault, sealOpts({ asset: 'ETH', direction: DOWN, horizon: BigInt(12 * H) }), io);
    expect([a.label, b.label]).toEqual(['RC-0001', 'RC-0002']);
    expect(vault.entries.map((e) => e.state)).toEqual(['sealed', 'sealed']);
    await expect(seal(ctx, signer, vault, sealOpts({ label: 'RC-0001' }), io)).rejects.toThrow(/already in the vault/);
    // entry rounds: the first oracle rounds after the seal
    await push('BTC', '65000');
    await push('ETH', '3000');
  });

  it('refuses to reveal, share or export before the horizon', async () => {
    await expect(revealFromVault('RC-0001')).rejects.toThrow(/horizon has not passed/);
    await expect(share(ctx, vault, { ref: 'RC-0001', publisher, baseUrl: 'https://app.example' }, io)).rejects.toThrow(
      /refusing to share before the target/,
    );
    await expect(exportOpening(ctx, vault, { ref: 'RC-0001', publisher }, io)).rejects.toThrow(/before the target/);
  });

  it('reveals a HIT and a MISS with on-chain round proofs', async () => {
    await anvil.warp(4 * H + 1);
    await push('BTC', '66000');
    const a = await revealFromVault('RC-0001');
    expect(a).toEqual({
      outcome: 'HIT',
      voidReason: 'NONE',
      entryPrice: parsePrice('65000'),
      exitPrice: parsePrice('66000'),
    });
    await anvil.warp(8 * H);
    await push('ETH', '3100');
    const b = await revealFromVault('RC-0002');
    expect(b.outcome).toBe('MISS');
    expect(vault.entries.map((e) => [e.label, e.state, e.outcome])).toEqual([
      ['RC-0001', 'revealed', 'HIT'],
      ['RC-0002', 'revealed', 'MISS'],
    ]);
    await expect(revealFromVault('RC-0001')).rejects.toThrow(/already settled: HIT/);
  });

  it('lets a verifier reveal a FLAT call from an exported opening, and builds a share link', async () => {
    await anvil.warp(60); // the last ETH round must be strictly older than the next seals (see the VOID test)
    const c = await seal(ctx, signer, vault, sealOpts({}), io);
    const d = await seal(ctx, signer, vault, sealOpts({ asset: 'ETH' }), io);
    expect([c.label, d.label]).toEqual(['RC-0003', 'RC-0004']);
    await push('BTC', '65000');
    await anvil.warp(4 * H + 1);
    await push('BTC', '65010'); // 1.5 bps move, inside the 10 bps flat band

    const url = await share(ctx, vault, { ref: 'RC-0003', publisher, baseUrl: 'https://app.example/poc/' }, io);
    expect(url.startsWith('https://app.example/poc/#/call/31337/')).toBe(true);
    const route = parseCallRoute(new URL(url).hash);
    expect(route?.opening?.salt).toBe(c.salt);

    const dir = mkdtempSync(join(tmpdir(), 'poc-open-'));
    const file = await exportOpening(ctx, vault, { ref: 'RC-0003', publisher, out: join(dir, 'o.json') }, io);
    const opening = parseOpeningJson(readFileSync(file, 'utf8'));
    expect(openingMatches(opening, computeCommitment(opening))).toBe(true);
    await expect(exportOpening(ctx, vault, { ref: 'RC-0003', publisher, out: file }, io)).rejects.toThrow(
      /not overwriting/,
    );

    const result = await reveal(ctx, signer, { opening }, { ref: 'opening', from: verifier, yes: true }, io);
    expect(result.outcome).toBe('FLAT');
  });

  it('voids a call when the feed stalls (stall proof), instead of guessing', async () => {
    await expect(revealFromVault('RC-0004')).rejects.toThrow(/stall proof becomes valid/);
    await anvil.warp(MAX_GAP + 1);
    const d = await revealFromVault('RC-0004');
    expect(d).toMatchObject({ outcome: 'VOID', voidReason: 'ENTRY_STALLED' });
  });

  it('lets anyone expire an unrevealed call after its deadline, as a MISS', async () => {
    const e = await seal(ctx, signer, vault, sealOpts({ direction: DOWN }), io);
    await expect(expire(ctx, signer, { ref: e.label, publisher, from: verifier, yes: true }, io)).rejects.toThrow(
      /still open/,
    );
    await anvil.warp(4 * H + MAX_GAP + 24 * H + 60);
    await expect(revealFromVault(e.label)).rejects.toThrow(/reveal window closed/);
    await expire(ctx, signer, { ref: e.label, publisher, from: verifier, yes: true }, io);
    const card = await ctx.client.readContract({
      address: dep.poc,
      abi: proofOfCallAbi,
      functionName: 'scorecard',
      args: [publisher],
    });
    expect(card).toEqual({ sealedCalls: 5n, hits: 1n, misses: 2n, flats: 1n, voids: 1n, expiries: 1n });
  });

  it('lists the vault with live status and spots a seal that was never mined', async () => {
    const failing: Signer = { description: 'failing', send: () => Promise.reject(new Error('wallet closed')) };
    await expect(seal(ctx, failing, vault, sealOpts({}), io)).rejects.toThrow(/wallet closed/);
    const rows = await list(ctx, vault, io);
    expect(rows.map((r) => r.status)).toEqual([
      'HIT',
      'MISS',
      'FLAT',
      'VOID',
      'EXPIRED',
      'not sealed (transaction never mined)',
    ]);
  });

  it('only lets the mock admin push prices, and asks before sending without --yes', async () => {
    await expect(mockPush(ctx, signer, { asset: 'BTC', answer: 1n, from: publisher, yes: true }, io)).rejects.toThrow(
      /only the mock admin/,
    );
    const careful = testIo({ confirm: false });
    await expect(mockPush(ctx, signer, { asset: 'BTC', answer: 1n, from: admin, yes: false }, careful)).rejects.toThrow(
      /not confirmed/,
    );
    expect(careful.confirms).toHaveLength(1);
  });

  it('runs as the built command (npm run poc) and exits 2 on usage errors', async () => {
    const main = new URL('../dist/main.js', import.meta.url);
    if (!existsSync(main)) throw new Error('build first: npm run build');
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, [
      main.pathname,
      'info',
      '--network',
      'local',
      '--deployments',
      dep.dir,
    ]);
    expect(stdout).toMatch(/ProofOfCall\s+0x[0-9a-fA-F]{40}/);
    expect(stdout).toMatch(/feed BTC/);
    await expect(
      run(process.execPath, [main.pathname, 'seal', '--network', 'local', '--deployments', dep.dir]),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('missing --asset') as unknown,
    });
  });

  it('the read layer rebuilds every call, the scorecard and the verifiers from events alone', async () => {
    const store = memoryStore();
    const first = await syncEvents(ctx.client, ctx.network, store, { chunkSize: 3n, reorgDepth: 2n });
    expect(first.cachedThrough).toBeNull();
    const index = buildIndex(first.events);
    expect(index.anomalies).toEqual([]);
    const revealers = new Map<string, Address>();
    await resolveRevealers(ctx.client, index, revealers);
    expect(scorecardOf(index, publisher)).toEqual(await readScorecard(ctx.client, dep.poc, publisher));
    const now = (await ctx.client.getBlock()).timestamp;
    const status = Object.fromEntries([...index.calls.values()].map((c) => [c.label ?? c.callId, callStatus(c, now)]));
    expect(status).toEqual({
      'RC-0001': 'HIT',
      'RC-0002': 'MISS',
      'RC-0003': 'FLAT',
      'RC-0004': 'VOID',
      'RC-0005': 'EXPIRED',
    });
    expect(verifierWallets(index)).toEqual([{ address: verifier, reveals: 1, expiries: 1 }]);

    // Second load: everything up to head - reorgDepth comes from the cache, only the tail is fetched again.
    const second = await syncEvents(ctx.client, ctx.network, store, { reorgDepth: 2n });
    expect(second.cachedThrough).toBe(first.headBlock - 2n);
    expect(second.events).toEqual(first.events);

    if (process.env.UPDATE_FIXTURES === '1') {
      const fixture = {
        note: 'Recorded from a local anvil run of packages/cli/test/lifecycle.anvil.test.ts (UPDATE_FIXTURES=1). Local chain data, not QIE testnet or mainnet.',
        chainId: 31337,
        contract: dep.poc,
        deployBlock: ctx.network.proofOfCall?.deployBlock.toString(),
        headBlock: first.headBlock.toString(),
        now: now.toString(),
        publisher,
        verifier,
        feeds: { BTC: dep.btc, ETH: dep.eth },
        revealers: Object.fromEntries(revealers),
        events: serializeEvents(first.events),
      };
      writeFileSync(
        new URL('../../core/test/fixtures/local-anvil-events.json', import.meta.url),
        `${JSON.stringify(fixture, null, 2)}\n`,
      );
    }
  });
});
