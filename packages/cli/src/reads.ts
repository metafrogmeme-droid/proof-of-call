import { proofOfCallAbi, type OnchainCall } from '@proof-of-call/core';
import type { Address, Hex } from 'viem';
import type { Ctx } from './context.js';

export async function readCall(ctx: Ctx, publisher: Address, callId: Hex): Promise<OnchainCall> {
  const c = await ctx.client.readContract({
    address: ctx.contract,
    abi: proofOfCallAbi,
    functionName: 'getCall',
    args: [publisher, callId],
  });
  return {
    commitment: c.commitment,
    sealedAt: c.sealedAt,
    horizon: c.horizon,
    revealBy: c.revealBy,
    maxGap: c.maxGap,
    flatBandBps: c.flatBandBps,
    outcome: c.outcome,
    voidReason: c.voidReason,
    direction: c.direction,
    feed: c.feed,
    entryRound: c.entryRound,
    exitRound: c.exitRound,
    entryPrice: c.entryPrice,
    exitPrice: c.exitPrice,
  };
}

export async function readDefaults(ctx: Ctx): Promise<{ maxGap: bigint; flatBandBps: number }> {
  const [maxGap, flatBandBps] = await Promise.all([
    ctx.client.readContract({ address: ctx.contract, abi: proofOfCallAbi, functionName: 'defaultMaxGap' }),
    ctx.client.readContract({ address: ctx.contract, abi: proofOfCallAbi, functionName: 'defaultFlatBandBps' }),
  ]);
  return { maxGap: BigInt(maxGap), flatBandBps };
}
