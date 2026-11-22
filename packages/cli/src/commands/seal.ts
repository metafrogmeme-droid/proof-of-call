import {
  callIdToLabel,
  callRoute,
  computeCommitment,
  directionName,
  feedFor,
  formatDuration,
  formatTimestamp,
  labelToCallId,
  proofOfCallAbi,
  randomSalt,
  revealByFor,
  type Asset,
  type Direction,
} from '@proof-of-call/core';
import { decodeEventLog, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readCall, readDefaults } from '../reads.js';
import type { Signer } from '../signers/index.js';
import { sendAndConfirm } from '../tx.js';
import type { Vault, VaultEntry } from '../vault.js';

export interface SealOptions {
  asset: Asset;
  direction: Direction;
  horizon: bigint;
  from: Address;
  label?: string | undefined;
  labelPrefix: string;
  revealWindow: bigint;
  yes: boolean;
}

async function nextLabel(
  ctx: Ctx,
  vault: Vault,
  publisher: Address,
  prefix: string,
): Promise<{ label: string; callId: Hex }> {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let n = 1;
  for (const e of vault.entries) {
    if (e.chainId !== ctx.network.chainId || getAddress(e.publisher) !== getAddress(publisher)) continue;
    const m = re.exec(e.label);
    if (m?.[1]) n = Math.max(n, Number(m[1]) + 1);
  }
  for (let tries = 0; tries < 1000; tries++, n++) {
    const label = `${prefix}-${String(n).padStart(4, '0')}`;
    const callId = labelToCallId(label);
    if ((await readCall(ctx, publisher, callId)).sealedAt === 0n) return { label, callId };
  }
  throw new Error('could not find a free call label; pass --label');
}

/** Seals a call: random salt, commitment, vault entry written first, then the transaction. */
export async function seal(ctx: Ctx, signer: Signer, vault: Vault, o: SealOptions, io: Io): Promise<VaultEntry> {
  const { network } = ctx;
  if (!network.feedsVerified)
    throw new Error(`the ${network.name} feed addresses are not verified yet; refusing to seal`);
  const feed = feedFor(network, o.asset);
  const publisher = getAddress(o.from);

  const [now, defaults] = await Promise.all([chainNow(ctx), readDefaults(ctx)]);
  const allowed = await ctx.client.readContract({
    address: ctx.contract,
    abi: proofOfCallAbi,
    functionName: 'isFeedAllowedAt',
    args: [feed.address, now],
  });
  if (!allowed) throw new Error(`${feed.pair} (${feed.address}) is not on the ProofOfCall allowlist`);

  let label: string;
  let callId: Hex;
  if (o.label) {
    label = o.label;
    callId = labelToCallId(label);
    if (vault.find(network.chainId, ctx.contract, publisher, callId))
      throw new Error(`call ${label} is already in the vault`);
    if ((await readCall(ctx, publisher, callId)).sealedAt !== 0n)
      throw new Error(`call ${label} is already sealed on chain`);
  } else {
    ({ label, callId } = await nextLabel(ctx, vault, publisher, o.labelPrefix));
  }

  const salt = randomSalt();
  const commitment = computeCommitment({
    chainId: network.chainId,
    contract: ctx.contract,
    publisher,
    callId,
    feed: feed.address,
    direction: o.direction,
    salt,
  });
  const revealBy = revealByFor(now, o.horizon, defaults.maxGap, o.revealWindow);
  const data = encodeFunctionData({
    abi: proofOfCallAbi,
    functionName: 'seal',
    args: [callId, commitment, o.horizon, revealBy],
  });
  await ctx.client.simulateContract({
    address: ctx.contract,
    abi: proofOfCallAbi,
    functionName: 'seal',
    args: [callId, commitment, o.horizon, revealBy],
    account: publisher,
  });

  io.out(`network     ${network.name} (chain ${network.chainId}), ProofOfCall ${ctx.contract}`);
  io.out(`publisher   ${publisher}`);
  io.out(`call        ${label} (${callId})`);
  io.out(
    `call        ${o.asset} ${directionName(o.direction)} over ${formatDuration(o.horizon)}  [stays hidden on chain until revealed]`,
  );
  io.out(`target      ~${formatTimestamp(now + o.horizon)}`);
  io.out(`reveal by   ${formatTimestamp(revealBy)} (after that anyone can expire it and it counts as a MISS)`);
  io.out(`scoring     maxGap ${formatDuration(defaults.maxGap)}, flat band ${defaults.flatBandBps} bps`);
  if (network.key === 'mainnet' || !o.yes) {
    if (!(await io.confirm(`Seal this call on ${network.name}?`))) throw new Error('not confirmed; nothing sent');
  }

  const entry: VaultEntry = {
    chainId: network.chainId,
    contract: ctx.contract,
    publisher,
    callId,
    label,
    asset: o.asset,
    feed: feed.address,
    direction: o.direction,
    salt,
    horizon: o.horizon.toString(),
    revealBy: revealBy.toString(),
    createdAt: new Date().toISOString(),
    state: 'prepared',
  };
  vault.put(entry); // the opening is on disk before anything is sent

  const receipt = await sendAndConfirm(
    ctx,
    signer,
    {
      chainId: network.chainId,
      from: publisher,
      to: ctx.contract,
      data,
      title: `Seal call ${label} on ${network.name}`,
      details: [
        `Horizon ${formatDuration(o.horizon)}, reveal by ${formatTimestamp(revealBy)}`,
        'Asset and direction are not shown here: they stay sealed until you reveal.',
      ],
    },
    io,
  );

  let sealedAt: bigint | undefined;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(ctx.contract)) continue;
    try {
      const ev = decodeEventLog({ abi: proofOfCallAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Sealed' && ev.args.callId === callId && ev.args.commitment === commitment)
        sealedAt = ev.args.sealedAt;
    } catch {
      // other events
    }
  }
  if (sealedAt === undefined) throw new Error('no matching Sealed event in the receipt');

  const sealed: VaultEntry = {
    ...entry,
    state: 'sealed',
    sealTx: receipt.transactionHash,
    sealedAt: sealedAt.toString(),
  };
  vault.put(sealed);
  io.out(`sealed      ${label} at ${formatTimestamp(sealedAt)}; target ${formatTimestamp(sealedAt + o.horizon)}`);
  io.out(`proof page  ${callRoute(network.chainId, publisher, callId)}`);
  io.out(
    `next        reveal after the target: poc reveal ${callIdToLabel(callId) ?? callId} --network ${network.key} ...`,
  );
  return sealed;
}
