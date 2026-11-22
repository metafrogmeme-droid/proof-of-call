import {
  callPhase,
  computeCommitment,
  contractFeedReader,
  directionName,
  findProofRound,
  formatPrice,
  formatTimestamp,
  outcomeName,
  parseCallRef,
  proofOfCallAbi,
  targetTime,
  voidReasonName,
  type Opening,
  type OutcomeName,
  type RoundProof,
} from '@proof-of-call/core';
import { decodeEventLog, encodeFunctionData, getAddress, type Address } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readCall } from '../reads.js';
import type { Signer } from '../signers/index.js';
import { sendAndConfirm } from '../tx.js';
import type { Vault } from '../vault.js';

export interface RevealOptions {
  ref: string;
  /** Sender of the reveal transaction (anyone). */
  from: Address;
  /** Publisher of the call; defaults to --from. */
  publisher?: Address | undefined;
  yes: boolean;
}

export interface RevealResult {
  outcome: OutcomeName;
  voidReason: string;
  entryPrice: bigint;
  exitPrice: bigint;
}

function roundOrWait(p: RoundProof, what: string): bigint {
  if (p.kind === 'wait') {
    throw new Error(
      `the feed has no round after the ${what} yet; a stall proof becomes valid at ${formatTimestamp(p.until)}. Try again later.`,
    );
  }
  return p.roundId;
}

/**
 * Reveals a call from the vault, or from an opening (e.g. an exported opening file). Finds the two round ids the
 * contract will prove, simulates, then sends.
 */
export async function reveal(
  ctx: Ctx,
  signer: Signer,
  source: { vault: Vault } | { opening: Opening },
  o: RevealOptions,
  io: Io,
): Promise<RevealResult> {
  const { network } = ctx;
  let opening: Opening;
  if ('vault' in source) {
    const publisher = getAddress(o.publisher ?? o.from);
    const callId = parseCallRef(o.ref);
    const entry = source.vault.find(network.chainId, ctx.contract, publisher, callId);
    if (!entry) throw new Error(`no opening for ${o.ref} (publisher ${publisher}) in the vault`);
    opening = {
      chainId: entry.chainId,
      contract: entry.contract,
      publisher,
      callId,
      feed: entry.feed,
      direction: entry.direction,
      salt: entry.salt,
    };
  } else {
    opening = source.opening;
    if (opening.chainId !== network.chainId || getAddress(opening.contract) !== getAddress(ctx.contract)) {
      throw new Error('the opening belongs to another chain or contract');
    }
  }

  const call = await readCall(ctx, opening.publisher, opening.callId);
  if (call.commitment !== computeCommitment(opening))
    throw new Error('the opening does not match the sealed commitment');
  const now = await chainNow(ctx);
  const phase = callPhase(call, now);
  if (phase === 'unknown') throw new Error('no such call on chain');
  if (phase === 'settled') throw new Error(`already settled: ${outcomeName(call.outcome)}`);
  if (phase === 'waiting')
    throw new Error(`the horizon has not passed yet: target ${formatTimestamp(targetTime(call))}`);
  if (phase === 'expirable')
    throw new Error(`the reveal window closed at ${formatTimestamp(call.revealBy)}; the call can only be expired`);

  const reader = contractFeedReader(ctx.client, opening.feed);
  const maxGap = BigInt(call.maxGap);
  const entryRound = roundOrWait(await findProofRound(reader, call.sealedAt, maxGap, now), 'seal');
  const exitRound = roundOrWait(await findProofRound(reader, targetTime(call), maxGap, now), 'target');
  const args = [
    opening.publisher,
    opening.callId,
    opening.feed,
    opening.direction,
    opening.salt,
    entryRound,
    exitRound,
  ] as const;
  const { result } = await ctx.client.simulateContract({
    address: ctx.contract,
    abi: proofOfCallAbi,
    functionName: 'reveal',
    args,
    account: o.from,
  });

  io.out(`call        ${opening.callId} by ${opening.publisher}`);
  io.out(
    `opening     ${directionName(opening.direction)} on feed ${opening.feed} (becomes public with this transaction)`,
  );
  io.out(`rounds      entry ${entryRound}, exit ${exitRound}; expected outcome ${outcomeName(result)}`);
  if (network.key === 'mainnet' || !o.yes) {
    if (!(await io.confirm(`Reveal on ${network.name}? The call becomes public.`)))
      throw new Error('not confirmed; nothing sent');
  }

  const receipt = await sendAndConfirm(
    ctx,
    signer,
    {
      chainId: network.chainId,
      from: getAddress(o.from),
      to: ctx.contract,
      data: encodeFunctionData({ abi: proofOfCallAbi, functionName: 'reveal', args }),
      title: `Reveal a call on ${network.name}`,
      details: ['This makes the asset and direction of the call public and scores it against the oracle.'],
    },
    io,
  );

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(ctx.contract)) continue;
    try {
      const ev = decodeEventLog({ abi: proofOfCallAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Revealed' && ev.args.callId === opening.callId) {
        const out: RevealResult = {
          outcome: outcomeName(ev.args.outcome),
          voidReason: voidReasonName(ev.args.voidReason),
          entryPrice: ev.args.entryPrice,
          exitPrice: ev.args.exitPrice,
        };
        if ('vault' in source) {
          const entry = source.vault.find(network.chainId, ctx.contract, opening.publisher, opening.callId);
          if (entry)
            source.vault.put({ ...entry, state: 'revealed', revealTx: receipt.transactionHash, outcome: out.outcome });
        }
        const prices =
          out.outcome === 'VOID'
            ? `void reason ${out.voidReason}`
            : `entry ${formatPrice(out.entryPrice)} -> exit ${formatPrice(out.exitPrice)}`;
        io.out(`revealed    ${out.outcome} (${prices})`);
        return out;
      }
    } catch {
      // other events
    }
  }
  throw new Error('no Revealed event in the receipt');
}
