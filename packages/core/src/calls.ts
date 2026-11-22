import type { Address, Hex } from 'viem';

export const OUTCOMES = ['OPEN', 'HIT', 'MISS', 'FLAT', 'VOID', 'EXPIRED'] as const;
export type OutcomeName = (typeof OUTCOMES)[number];

export const VOID_REASONS = ['NONE', 'ENTRY_STALLED', 'EXIT_STALLED', 'ENTRY_BAD_DATA', 'EXIT_BAD_DATA'] as const;
export type VoidReasonName = (typeof VOID_REASONS)[number];

export function outcomeName(value: number): OutcomeName {
  const name = OUTCOMES[value];
  if (name === undefined) throw new Error(`unknown outcome ${value}`);
  return name;
}

export function voidReasonName(value: number): VoidReasonName {
  const name = VOID_REASONS[value];
  if (name === undefined) throw new Error(`unknown void reason ${value}`);
  return name;
}

/** The horizons the owner seals (decision of 22 Nov 2026). The contract itself allows 5 minutes to 366 days. */
export const HORIZONS = { '4h': 4n * 3600n, '12h': 12n * 3600n } as const;
export type HorizonKey = keyof typeof HORIZONS;

export function parseHorizon(value: string): bigint {
  if (value === '4h' || value === '12h') return HORIZONS[value];
  throw new Error(`horizon must be 4h or 12h, got "${value}"`);
}

/** Contract bound: revealBy >= target + maxGap + 1 h and <= target + maxGap + 30 days. */
export const CONTRACT_MIN_REVEAL_WINDOW = 3600n;
export const CONTRACT_MAX_REVEAL_WINDOW = 30n * 86_400n;
/** One hour of slack on each side for the time between reading the chain and the seal being mined. */
export const MIN_REVEAL_WINDOW = CONTRACT_MIN_REVEAL_WINDOW + 3600n;
export const MAX_REVEAL_WINDOW = CONTRACT_MAX_REVEAL_WINDOW - 86_400n;
export const DEFAULT_REVEAL_WINDOW = 24n * 3600n;

/** revealBy for a seal sent at about `now`: target + maxGap + window. */
export function revealByFor(
  now: bigint,
  horizon: bigint,
  maxGap: bigint,
  window: bigint = DEFAULT_REVEAL_WINDOW,
): bigint {
  if (window < MIN_REVEAL_WINDOW || window > MAX_REVEAL_WINDOW) {
    throw new Error(
      `reveal window must be between ${formatDuration(MIN_REVEAL_WINDOW)} and ${formatDuration(MAX_REVEAL_WINDOW)}`,
    );
  }
  return now + horizon + maxGap + window;
}

/** ProofOfCall.Call as returned by getCall. */
export interface OnchainCall {
  commitment: Hex;
  sealedAt: bigint;
  horizon: bigint;
  revealBy: bigint;
  maxGap: number;
  flatBandBps: number;
  outcome: number;
  voidReason: number;
  direction: number;
  feed: Address;
  entryRound: bigint;
  exitRound: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
}

export type CallPhase = 'unknown' | 'waiting' | 'revealable' | 'expirable' | 'settled';

export function targetTime(call: Pick<OnchainCall, 'sealedAt' | 'horizon'>): bigint {
  return call.sealedAt + call.horizon;
}

/** What can happen to a call at time `now` (seconds). */
export function callPhase(call: OnchainCall, now: bigint): CallPhase {
  if (call.sealedAt === 0n) return 'unknown';
  if (call.outcome !== 0) return 'settled';
  if (now < targetTime(call)) return 'waiting';
  if (now <= call.revealBy) return 'revealable';
  return 'expirable';
}

const UNITS: readonly [string, bigint][] = [
  ['d', 86_400n],
  ['h', 3600n],
  ['m', 60n],
  ['s', 1n],
];

/** "24h", "90m", "2d", "1h30m" -> seconds. */
export function parseDuration(value: string): bigint {
  const re = /(\d+)\s*([dhms])/gy;
  let total = 0n;
  let consumed = 0;
  for (const match of value.trim().matchAll(re)) {
    const [whole, amount, unit] = match;
    const factor = UNITS.find(([u]) => u === unit)?.[1];
    if (amount === undefined || factor === undefined) break;
    total += BigInt(amount) * factor;
    consumed += whole.length;
  }
  if (consumed === 0 || consumed !== value.trim().length)
    throw new Error(`invalid duration "${value}" (e.g. 24h, 90m, 2d)`);
  return total;
}

export function formatDuration(seconds: bigint): string {
  if (seconds < 0n) return `-${formatDuration(-seconds)}`;
  if (seconds === 0n) return '0s';
  const parts: string[] = [];
  let rest = seconds;
  for (const [unit, size] of UNITS) {
    const n = rest / size;
    if (n > 0n) parts.push(`${n}${unit}`);
    rest %= size;
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export function formatTimestamp(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().replace('.000Z', 'Z');
}

/** 6543210000000 (8 decimals) -> "65432.1" */
export function formatPrice(answer: bigint, decimals = 8): string {
  const negative = answer < 0n;
  const abs = negative ? -answer : answer;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** "65432.10" -> 6543210000000 (8 decimals). */
export function parsePrice(value: string, decimals = 8): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`invalid price "${value}"`);
  const [, whole = '0', frac = ''] = match;
  if (frac.length > decimals) throw new Error(`price "${value}" has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}
