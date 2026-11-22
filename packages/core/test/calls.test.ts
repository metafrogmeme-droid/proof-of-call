import { describe, expect, it } from 'vitest';
import {
  callPhase,
  DEFAULT_REVEAL_WINDOW,
  formatDuration,
  formatPrice,
  formatTimestamp,
  HORIZONS,
  outcomeName,
  parseDuration,
  parseHorizon,
  parsePrice,
  revealByFor,
  voidReasonName,
  type OnchainCall,
} from '../src/index.js';

const call = (over: Partial<OnchainCall> = {}): OnchainCall => ({
  commitment: `0x${'ab'.repeat(32)}`,
  sealedAt: 1000n,
  horizon: 4n * 3600n,
  revealBy: 1000n + 4n * 3600n + 6n * 3600n + 24n * 3600n,
  maxGap: 21600,
  flatBandBps: 10,
  outcome: 0,
  voidReason: 0,
  direction: 0,
  feed: '0x0000000000000000000000000000000000000000',
  entryRound: 0n,
  exitRound: 0n,
  entryPrice: 0n,
  exitPrice: 0n,
  ...over,
});

describe('call phases', () => {
  it('moves from waiting to revealable to expirable', () => {
    const c = call();
    const target = c.sealedAt + c.horizon;
    expect(callPhase(c, target - 1n)).toBe('waiting');
    expect(callPhase(c, target)).toBe('revealable');
    expect(callPhase(c, c.revealBy)).toBe('revealable');
    expect(callPhase(c, c.revealBy + 1n)).toBe('expirable');
    expect(callPhase(call({ outcome: 1 }), target)).toBe('settled');
    expect(callPhase(call({ sealedAt: 0n }), target)).toBe('unknown');
  });
});

describe('revealByFor', () => {
  it('is target + maxGap + window and keeps an hour of slack on the contract bounds', () => {
    expect(revealByFor(1000n, HORIZONS['4h'], 21600n)).toBe(1000n + 14400n + 21600n + DEFAULT_REVEAL_WINDOW);
    expect(() => revealByFor(1000n, HORIZONS['4h'], 21600n, 3600n)).toThrow(/reveal window/);
    expect(() => revealByFor(1000n, HORIZONS['4h'], 21600n, 30n * 86400n)).toThrow(/reveal window/);
    expect(revealByFor(0n, 1n, 0n, 2n * 3600n)).toBe(7201n);
  });
});

describe('parsers and formatters', () => {
  it('parses horizons and durations', () => {
    expect(parseHorizon('4h')).toBe(14400n);
    expect(parseHorizon('12h')).toBe(43200n);
    expect(() => parseHorizon('1h')).toThrow();
    expect(parseDuration('24h')).toBe(86400n);
    expect(parseDuration('1h30m')).toBe(5400n);
    expect(parseDuration('2d')).toBe(172800n);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('24h tomorrow')).toThrow();
  });

  it('formats durations, timestamps and prices', () => {
    expect(formatDuration(0n)).toBe('0s');
    expect(formatDuration(14399n)).toBe('3h 59m');
    expect(formatDuration(90061n)).toBe('1d 1h');
    expect(formatDuration(-60n)).toBe('-1m');
    expect(formatTimestamp(1_800_000_000n)).toBe('2027-01-15T08:00:00Z');
    expect(formatPrice(6_543_210_000_000n)).toBe('65432.1');
    expect(formatPrice(100_000_000n)).toBe('1');
    expect(formatPrice(-5n)).toBe('-0.00000005');
    expect(parsePrice('65432.10')).toBe(6_543_210_000_000n);
    expect(parsePrice('1')).toBe(100_000_000n);
    expect(() => parsePrice('1.123456789')).toThrow();
    expect(() => parsePrice('-1')).toThrow();
  });

  it('names outcomes and void reasons', () => {
    expect(outcomeName(1)).toBe('HIT');
    expect(outcomeName(5)).toBe('EXPIRED');
    expect(voidReasonName(2)).toBe('EXIT_STALLED');
    expect(() => outcomeName(6)).toThrow();
  });
});
