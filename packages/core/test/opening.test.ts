import { describe, expect, it } from 'vitest';
import {
  callRoute,
  computeCommitment,
  DOWN,
  labelToCallId,
  openingMatches,
  openingToJson,
  parseCallRoute,
  parseOpeningJson,
  shareFragment,
  type Opening,
} from '../src/index.js';

const OPENING: Opening = {
  chainId: 1983,
  contract: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
  publisher: '0x020A4366595292aa16184536bAB2E9949d0D925F',
  callId: labelToCallId('RC-0007'),
  feed: '0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82',
  direction: DOWN,
  salt: `0x${'5a'.repeat(32)}`,
};

describe('call routes and reveal links', () => {
  it('builds and parses a plain proof page route', () => {
    const route = callRoute(OPENING.chainId, OPENING.publisher, OPENING.callId);
    expect(route).toBe(`#/call/1983/${OPENING.publisher}/${OPENING.callId}`);
    expect(parseCallRoute(route)).toEqual({
      chainId: 1983,
      publisher: OPENING.publisher,
      callId: OPENING.callId,
      opening: null,
    });
  });

  it('round-trips a reveal link with the opening in the fragment', () => {
    const parsed = parseCallRoute(shareFragment(OPENING));
    expect(parsed?.opening).toEqual({ feed: OPENING.feed, direction: DOWN, salt: OPENING.salt });
  });

  it('ignores other routes and rejects malformed openings', () => {
    expect(parseCallRoute('#/publisher/0x020A4366595292aa16184536bAB2E9949d0D925F')).toBeNull();
    expect(parseCallRoute('#/call/1983/0x12/0x34')).toBeNull();
    expect(() =>
      parseCallRoute(`${callRoute(1983, OPENING.publisher, OPENING.callId)}?feed=0x1&dir=up&salt=0x2`),
    ).toThrow();
  });
});

describe('opening files', () => {
  it('round-trips and verifies against the commitment', () => {
    const parsed = parseOpeningJson(openingToJson(OPENING));
    expect(parsed).toEqual(OPENING);
    expect(openingMatches(parsed, computeCommitment(OPENING))).toBe(true);
    expect(openingMatches({ ...parsed, direction: 1 }, computeCommitment(OPENING))).toBe(false);
  });

  it('rejects other files', () => {
    expect(() => parseOpeningJson('nope')).toThrow(/JSON/);
    expect(() => parseOpeningJson('{"type":"x","version":1}')).toThrow(/opening file/);
    const bad = JSON.parse(openingToJson(OPENING)) as Record<string, unknown>;
    bad.salt = '0x12';
    expect(() => parseOpeningJson(JSON.stringify(bad))).toThrow(/salt/);
  });
});
