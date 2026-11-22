import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

/** Small runtime checks for JSON read from files, URLs or the user. They throw with the field name. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field}: expected an object`);
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field}: expected a non-empty string`);
  return value;
}

export function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${field}: expected an integer`);
  return value;
}

/** A checksummed, non-zero address. */
export function requireAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }))
    throw new Error(`${field}: expected an address`);
  const address = getAddress(value);
  if (address === ZERO_ADDRESS) throw new Error(`${field}: zero address`);
  return address;
}

export function requireBytes32(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length !== 66) {
    throw new Error(`${field}: expected 32 bytes of hex (0x + 64 hex digits)`);
  }
  return value.toLowerCase() as Hex;
}

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
