import {
  computeCommitment,
  contractFeedReader,
  outcomeName,
  proofOfCallAbi,
  targetOf,
  voidReasonName,
  type CallRecord,
  type NetworkInfo,
  type RoundData,
} from '@proof-of-call/core';
import { decodeFunctionData, type PublicClient } from 'viem';
import { utc } from './format';

export interface Check {
  label: string;
  ok: boolean | null;
  detail: string;
}

/**
 * Re-checks a revealed call in the browser, independently of the app's own logic:
 * 1. the salt from the reveal transaction hashes, with the revealed feed and direction, to the sealed commitment;
 * 2. the entry and exit rounds really are the first feed rounds at or after the seal and the target.
 */
export async function verifyRevealed(client: PublicClient, network: NetworkInfo, call: CallRecord): Promise<Check[]> {
  const revealed = call.revealed;
  const contract = network.proofOfCall?.address;
  if (!revealed || !contract) return [];
  const checks: Check[] = [];

  const tx = await client.getTransaction({ hash: revealed.tx });
  const { functionName, args } = decodeFunctionData({ abi: proofOfCallAbi, data: tx.input });
  if (functionName !== 'reveal') {
    checks.push({ label: 'Commitment', ok: false, detail: 'the reveal transaction does not call reveal()' });
  } else {
    const salt = args[4];
    const recomputed = computeCommitment({
      chainId: network.chainId,
      contract,
      publisher: call.publisher,
      callId: call.callId,
      feed: revealed.feed,
      direction: revealed.direction === 1 ? 1 : 2,
      salt,
    });
    checks.push({
      label: 'Commitment',
      ok: recomputed === call.sealed.commitment,
      detail: `keccak256(chainId, contract, publisher, callId, feed, direction, salt) = ${recomputed}`,
    });
  }

  const reader = contractFeedReader(client, revealed.feed);
  const proveFirst = async (label: string, roundId: bigint, t: bigint): Promise<Check> => {
    let r: RoundData;
    try {
      r = await reader.round(roundId);
    } catch {
      return { label, ok: null, detail: `round ${roundId} could not be read from the feed` };
    }
    if (r.updatedAt < t) {
      return {
        label,
        ok: null,
        detail: `round ${roundId} (${utc(r.updatedAt)}) is older than ${utc(t)}: a stall proof, accepted by the contract because it was the latest round and the feed had been silent for more than ${call.sealed.maxGap} s`,
      };
    }
    if (roundId === 1n)
      return { label, ok: true, detail: `round 1 updated ${utc(r.updatedAt)} (first round of the feed)` };
    const prev = await reader.round(roundId - 1n);
    return {
      label,
      ok: prev.updatedAt < t,
      detail: `round ${roundId} updated ${utc(r.updatedAt)}; round ${roundId - 1n} updated ${utc(prev.updatedAt)}, before ${utc(t)}`,
    };
  };
  checks.push(await proveFirst('Entry round', revealed.entryRound, call.sealed.sealedAt));
  checks.push(await proveFirst('Exit round', revealed.exitRound, targetOf(call)));

  const outcome = outcomeName(revealed.outcome);
  checks.push({
    label: 'Outcome',
    ok: true,
    detail:
      outcome === 'VOID'
        ? `VOID (${voidReasonName(revealed.voidReason)}): no price was guessed`
        : `${outcome}, scored by the contract`,
  });
  return checks;
}
