import { bytesToHex, encodeAbiParameters, hexToBytes, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { requireBytes32 } from './validate.js';

export const UP = 1;
export const DOWN = 2;
export type Direction = typeof UP | typeof DOWN;

export function parseDirection(value: string): Direction {
  const v = value.trim().toLowerCase();
  if (v === 'up' || v === '1') return UP;
  if (v === 'down' || v === '2') return DOWN;
  throw new Error(`direction must be "up" or "down", got "${value}"`);
}

export function directionName(direction: number): 'UP' | 'DOWN' {
  if (direction === UP) return 'UP';
  if (direction === DOWN) return 'DOWN';
  throw new Error(`invalid direction ${direction}`);
}

export interface CommitmentInput {
  chainId: number | bigint;
  contract: Address;
  publisher: Address;
  callId: Hex;
  feed: Address;
  direction: Direction;
  salt: Hex;
}

const COMMITMENT_TYPES = [
  { type: 'uint256' },
  { type: 'address' },
  { type: 'address' },
  { type: 'bytes32' },
  { type: 'address' },
  { type: 'uint8' },
  { type: 'bytes32' },
] as const;

/**
 * keccak256(abi.encode(chainid, address(this), publisher, callId, feed, direction, salt)), byte for byte the same
 * as ProofOfCall.computeCommitment (checked against the contract in the anvil tests).
 */
export function computeCommitment(input: CommitmentInput): Hex {
  return keccak256(
    encodeAbiParameters(COMMITMENT_TYPES, [
      BigInt(input.chainId),
      input.contract,
      input.publisher,
      requireBytes32(input.callId, 'callId'),
      input.feed,
      input.direction,
      requireBytes32(input.salt, 'salt'),
    ]),
  );
}

/** 32 bytes from the platform CSPRNG (Web Crypto in browsers and Node). Never derive a salt from anything else. */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

const LABEL = /^[A-Za-z0-9._-]{1,31}$/;

/** A readable call id ("RC-0001") stored left-aligned in bytes32. It must not reveal the asset or direction. */
export function labelToCallId(label: string): Hex {
  if (!LABEL.test(label)) throw new Error('call label: 1-31 characters of A-Z a-z 0-9 . _ -');
  return stringToHex(label, { size: 32 });
}

/** The label of a bytes32 call id, or null when it is not a label written by labelToCallId. */
export function callIdToLabel(callId: Hex): string | null {
  const bytes = hexToBytes(requireBytes32(callId, 'callId'));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return null;
  for (let i = 0; i < end; i++) {
    const b = bytes[i];
    if (b === undefined || b < 0x20 || b > 0x7e) return null;
  }
  const label = new TextDecoder().decode(bytes.subarray(0, end));
  return LABEL.test(label) ? label : null;
}

/** Accepts either a 0x-prefixed bytes32 call id or a label. */
export function parseCallRef(ref: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(ref)) return ref.toLowerCase() as Hex;
  return labelToCallId(ref);
}
