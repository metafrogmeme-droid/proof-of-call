import { describe, expect, it } from 'vitest';
import { findProofRound, type FeedReader, type RoundData } from '../src/index.js';

/** A feed with rounds 1..n at the given update times. */
function feed(times: readonly bigint[], opts: { lieAt?: bigint } = {}): FeedReader & { reads: number } {
  const rounds: RoundData[] = times.map((t, i) => ({
    roundId: BigInt(i + 1),
    answer: 100n,
    updatedAt: t,
    answeredInRound: BigInt(i + 1),
  }));
  const f = {
    reads: 0,
    latest: () => Promise.resolve(rounds.at(-1) ?? { roundId: 0n, answer: 0n, updatedAt: 0n, answeredInRound: 0n }),
    round: (id: bigint) => {
      f.reads++;
      const r = rounds[Number(id) - 1];
      if (!r) return Promise.reject(new Error('no such round'));
      return Promise.resolve(opts.lieAt === id ? { ...r, roundId: id + 1000n } : r);
    },
  };
  return f;
}

const GAP = 3600n;

describe('findProofRound', () => {
  it('finds the first round at or after the target', async () => {
    const f = feed([100n, 200n, 300n, 400n, 500n]);
    await expect(findProofRound(f, 250n, GAP, 600n)).resolves.toEqual({ kind: 'round', roundId: 3n, updatedAt: 300n });
    await expect(findProofRound(f, 300n, GAP, 600n)).resolves.toEqual({ kind: 'round', roundId: 3n, updatedAt: 300n });
    await expect(findProofRound(f, 50n, GAP, 600n)).resolves.toEqual({ kind: 'round', roundId: 1n, updatedAt: 100n });
    await expect(findProofRound(f, 500n, GAP, 600n)).resolves.toEqual({ kind: 'round', roundId: 5n, updatedAt: 500n });
  });

  it('handles equal timestamps by taking the first of them', async () => {
    const f = feed([100n, 200n, 200n, 200n, 300n]);
    await expect(findProofRound(f, 200n, GAP, 600n)).resolves.toMatchObject({ kind: 'round', roundId: 2n });
  });

  it('waits while no round after the target exists and the stall proof is not valid yet', async () => {
    const f = feed([100n, 200n]);
    await expect(findProofRound(f, 250n, GAP, 1000n)).resolves.toEqual({ kind: 'wait', until: 250n + GAP + 1n });
    await expect(findProofRound(f, 250n, GAP, 250n + GAP)).resolves.toEqual({ kind: 'wait', until: 250n + GAP + 1n });
  });

  it('returns the latest round as a stall proof after maxGap of silence', async () => {
    const f = feed([100n, 200n]);
    await expect(findProofRound(f, 250n, GAP, 250n + GAP + 1n)).resolves.toEqual({
      kind: 'stall',
      roundId: 2n,
      updatedAt: 200n,
    });
  });

  it('handles a feed without rounds', async () => {
    const f = feed([]);
    await expect(findProofRound(f, 250n, GAP, 300n)).resolves.toEqual({ kind: 'wait', until: 250n + GAP + 1n });
    await expect(findProofRound(f, 250n, GAP, 250n + GAP + 1n)).rejects.toThrow(/no rounds/);
  });

  it('refuses phase-encoded round ids and lying feeds', async () => {
    const phased: FeedReader = {
      latest: () => Promise.resolve({ roundId: (1n << 64n) + 5n, answer: 1n, updatedAt: 500n, answeredInRound: 0n }),
      round: () => Promise.reject(new Error('unused')),
    };
    await expect(findProofRound(phased, 100n, GAP, 600n)).rejects.toThrow(/phase/);
    const liar = feed([100n, 200n, 300n, 400n], { lieAt: 2n });
    await expect(findProofRound(liar, 250n, GAP, 600n)).rejects.toThrow(/answered round/);
  });

  it('agrees with a linear scan and reads O(log n) rounds', async () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + (rand() % 300);
      const times: bigint[] = [];
      let t = 1_000n;
      for (let i = 0; i < n; i++) {
        t += BigInt(rand() % 3); // includes repeated timestamps
        times.push(t);
      }
      const last = times.at(-1) ?? 0n;
      const target = 1_000n + BigInt(rand() % Number(last - 999n));
      const expected = times.findIndex((x) => x >= target) + 1;
      const f = feed(times);
      const proof = await findProofRound(f, target, GAP, last + 1n);
      expect(proof).toMatchObject({ kind: 'round', roundId: BigInt(expected) });
      expect(f.reads).toBeLessThanOrEqual(Math.ceil(Math.log2(n)) + 1);
    }
  });
});
