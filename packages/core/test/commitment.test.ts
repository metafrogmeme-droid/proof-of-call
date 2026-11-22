import { describe, expect, it } from 'vitest';
import {
  callIdToLabel,
  computeCommitment,
  directionName,
  DOWN,
  labelToCallId,
  parseCallRef,
  parseDirection,
  randomSalt,
  UP,
  type CommitmentInput,
} from '../src/index.js';

// Reference values computed independently with `cast abi-encode` + `cast keccak` (Foundry).
const BASE: CommitmentInput = {
  chainId: 1983,
  contract: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
  publisher: '0x020A4366595292aa16184536bAB2E9949d0D925F',
  callId: '0x52432d3030303100000000000000000000000000000000000000000000000000',
  feed: '0xa1141220424Fc103d1631BAd44039CEc0C4B6D28',
  direction: UP,
  salt: `0x${'11'.repeat(32)}`,
};

describe('computeCommitment', () => {
  it('matches the cast reference vectors', () => {
    expect(computeCommitment(BASE)).toBe('0xb30a94955ca8a27922545fe56d834cce5080aaf474f53250ef823ec03fccf5b1');
    expect(computeCommitment({ ...BASE, direction: DOWN })).toBe(
      '0xd398a8a21ed178a833e5de2f375be32d9d901195bcc20d2600ffd06633170c53',
    );
  });

  it('changes when any bound field changes', () => {
    const base = computeCommitment(BASE);
    const variants: Partial<CommitmentInput>[] = [
      { chainId: 1990 },
      { contract: '0x0000000000000000000000000000000000000001' },
      { publisher: '0x0000000000000000000000000000000000000002' },
      { callId: labelToCallId('RC-0002') },
      { feed: '0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82' },
      { salt: `0x${'12'.repeat(32)}` },
    ];
    const seen = new Set([base]);
    for (const v of variants) seen.add(computeCommitment({ ...BASE, ...v }));
    expect(seen.size).toBe(variants.length + 1);
  });

  it('accepts bigint chain ids and mixed-case addresses', () => {
    expect(
      computeCommitment({ ...BASE, chainId: 1983n, publisher: '0x020a4366595292aa16184536bab2e9949d0d925f' }),
    ).toBe(computeCommitment(BASE));
  });

  it('rejects malformed salt and call ids', () => {
    expect(() => computeCommitment({ ...BASE, salt: '0x1234' })).toThrow(/salt/);
    expect(() => computeCommitment({ ...BASE, callId: '0x12' })).toThrow(/callId/);
  });
});

describe('randomSalt', () => {
  it('returns 32 fresh random bytes', () => {
    const salts = new Set(Array.from({ length: 64 }, () => randomSalt()));
    expect(salts.size).toBe(64);
    for (const s of salts) expect(s).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('call labels', () => {
  it('round-trips labels through bytes32', () => {
    expect(labelToCallId('RC-0001')).toBe(BASE.callId);
    expect(callIdToLabel(BASE.callId)).toBe('RC-0001');
    expect(callIdToLabel(labelToCallId('a'.repeat(31)))).toBe('a'.repeat(31));
  });

  it('rejects labels that are too long or use other characters', () => {
    expect(() => labelToCallId('')).toThrow();
    expect(() => labelToCallId('a'.repeat(32))).toThrow();
    expect(() => labelToCallId('BTC up!')).toThrow();
  });

  it('returns null for ids that are not labels', () => {
    expect(callIdToLabel(`0x${'00'.repeat(32)}`)).toBeNull();
    expect(callIdToLabel(`0x${'ff'.repeat(32)}`)).toBeNull();
    expect(callIdToLabel(`0x41${'00'.repeat(30)}42`)).toBeNull();
  });

  it('parses call references', () => {
    expect(parseCallRef('RC-0001')).toBe(BASE.callId);
    expect(parseCallRef(BASE.callId.toUpperCase().replace('0X', '0x'))).toBe(BASE.callId);
  });
});

describe('directions', () => {
  it('parses and names directions', () => {
    expect(parseDirection('up')).toBe(UP);
    expect(parseDirection(' DOWN ')).toBe(DOWN);
    expect(parseDirection('2')).toBe(DOWN);
    expect(() => parseDirection('sideways')).toThrow();
    expect(directionName(UP)).toBe('UP');
    expect(directionName(DOWN)).toBe('DOWN');
    expect(() => directionName(3)).toThrow();
  });
});
