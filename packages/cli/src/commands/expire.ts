import { callPhase, formatTimestamp, outcomeName, parseCallRef, proofOfCallAbi } from '@proof-of-call/core';
import { encodeFunctionData, getAddress, type Address } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readCall } from '../reads.js';
import type { Signer } from '../signers/index.js';
import { sendAndConfirm } from '../tx.js';

export interface ExpireOptions {
  ref: string;
  publisher: Address;
  from: Address;
  yes: boolean;
}

/** Closes a call that was not revealed by its deadline. Anyone may do this; it counts as a MISS for the publisher. */
export async function expire(ctx: Ctx, signer: Signer, o: ExpireOptions, io: Io): Promise<void> {
  const publisher = getAddress(o.publisher);
  const callId = parseCallRef(o.ref);
  const call = await readCall(ctx, publisher, callId);
  const phase = callPhase(call, await chainNow(ctx));
  if (phase === 'unknown') throw new Error('no such call on chain');
  if (phase === 'settled') throw new Error(`already settled: ${outcomeName(call.outcome)}`);
  if (phase !== 'expirable') throw new Error(`the reveal window is still open until ${formatTimestamp(call.revealBy)}`);
  const args = [publisher, callId] as const;
  await ctx.client.simulateContract({
    address: ctx.contract,
    abi: proofOfCallAbi,
    functionName: 'expire',
    args,
    account: o.from,
  });
  io.out(`call        ${callId} by ${publisher}: not revealed by ${formatTimestamp(call.revealBy)}`);
  if (ctx.network.key === 'mainnet' || !o.yes) {
    if (!(await io.confirm(`Expire it on ${ctx.network.name} (counts as a MISS for the publisher)?`)))
      throw new Error('not confirmed; nothing sent');
  }
  await sendAndConfirm(
    ctx,
    signer,
    {
      chainId: ctx.network.chainId,
      from: getAddress(o.from),
      to: ctx.contract,
      data: encodeFunctionData({ abi: proofOfCallAbi, functionName: 'expire', args }),
      title: `Expire an unrevealed call on ${ctx.network.name}`,
      details: ['The call was not revealed in time and is closed as a MISS.'],
    },
    io,
  );
  io.out('expired     counted as a MISS (expiry)');
}
