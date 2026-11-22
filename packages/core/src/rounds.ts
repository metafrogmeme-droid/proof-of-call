import type { Address, PublicClient } from 'viem';
import { aggregatorV3Abi } from './abi.js';

export interface RoundData {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

/** Read access to a Chainlink-style feed. */
export interface FeedReader {
  latest(): Promise<RoundData>;
  round(roundId: bigint): Promise<RoundData>;
}

/**
 * Which round id to pass to reveal() for one target time:
 * - `round`: the first round with updatedAt >= target (what the contract proves with round r and r - 1);
 * - `stall`: the feed has been silent since before the target for more than maxGap, so the latest round is a stall
 *   proof and the call will be VOID;
 * - `wait`: no round after the target yet, and the stall proof only becomes valid after `until`.
 */
export type RoundProof =
  | { kind: 'round'; roundId: bigint; updatedAt: bigint }
  | { kind: 'stall'; roundId: bigint; updatedAt: bigint }
  | { kind: 'wait'; until: bigint };

const PHASE_LIMIT = 1n << 64n;

export async function findProofRound(
  feed: FeedReader,
  target: bigint,
  maxGap: bigint,
  now: bigint,
): Promise<RoundProof> {
  const latest = await feed.latest();
  if (latest.roundId === 0n) {
    if (now > target + maxGap) throw new Error('feed has no rounds at all; the call cannot be revealed');
    return { kind: 'wait', until: target + maxGap + 1n };
  }
  if (latest.roundId >= PHASE_LIMIT) throw new Error('phase-encoded round ids are not supported (docs/DESIGN.md)');
  if (latest.updatedAt < target) {
    if (now > target + maxGap) return { kind: 'stall', roundId: latest.roundId, updatedAt: latest.updatedAt };
    return { kind: 'wait', until: target + maxGap + 1n };
  }
  // Binary search for the first round with updatedAt >= target in [1, latest]; latest satisfies it.
  let lo = 1n;
  let hi = latest.roundId;
  let hiUpdatedAt = latest.updatedAt;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const r = await readRound(feed, mid);
    if (r.updatedAt >= target) {
      hi = mid;
      hiUpdatedAt = r.updatedAt;
    } else {
      lo = mid + 1n;
    }
  }
  return { kind: 'round', roundId: hi, updatedAt: hiUpdatedAt };
}

async function readRound(feed: FeedReader, roundId: bigint): Promise<RoundData> {
  const r = await feed.round(roundId);
  if (r.roundId !== roundId) throw new Error(`feed answered round ${r.roundId} for round ${roundId}`);
  return r;
}

type ReadClient = Pick<PublicClient, 'readContract'>;

export function contractFeedReader(client: ReadClient, feed: Address): FeedReader {
  const toRound = ([roundId, answer, , updatedAt, answeredInRound]: readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ]) => ({
    roundId,
    answer,
    updatedAt,
    answeredInRound,
  });
  return {
    latest: async () =>
      toRound(await client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' })),
    round: async (roundId) =>
      toRound(
        await client.readContract({
          address: feed,
          abi: aggregatorV3Abi,
          functionName: 'getRoundData',
          args: [roundId],
        }),
      ),
  };
}
