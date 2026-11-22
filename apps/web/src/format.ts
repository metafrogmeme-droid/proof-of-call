import { formatDuration, formatPrice } from '@proof-of-call/core';
import type { Address } from 'viem';

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function utc(seconds: bigint): string {
  return new Date(Number(seconds) * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

/** "in 3h 12m" / "5m ago", relative to chain time. */
export function relative(seconds: bigint, now: bigint): string {
  if (seconds === now) return 'now';
  return seconds > now ? `in ${formatDuration(seconds - now)}` : `${formatDuration(now - seconds)} ago`;
}

export function price(answer: bigint, decimals = 8): string {
  const [whole = '0', frac = ''] = formatPrice(answer, decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac.slice(0, 2).padEnd(2, '0')}` : `${grouped}.00`;
}

/** Signed move in percent with two decimals, e.g. "+1.54 %". */
export function movePercent(entry: bigint, exit: bigint): string {
  if (entry <= 0n) return 'n/a';
  const bps = ((exit - entry) * 1_000_000n) / entry; // 1e-4 percent units
  const sign = bps > 0n ? '+' : bps < 0n ? '-' : '';
  const abs = bps < 0n ? -bps : bps;
  return `${sign}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, '0').slice(0, 2)} %`;
}

export function percent(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)} %`;
}

export function sameAddress(a: Address | null | undefined, b: Address | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
