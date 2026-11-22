import type { Address, Hex } from 'viem';
import { computeCommitment, DOWN, parseDirection, UP, type Direction } from './commitment.js';
import { isRecord, requireAddress, requireBytes32, requireInteger } from './validate.js';

/** Everything needed to reveal a call. Only the salt is secret, and only until the call's horizon has passed. */
export interface Opening {
  chainId: number;
  contract: Address;
  publisher: Address;
  callId: Hex;
  feed: Address;
  direction: Direction;
  salt: Hex;
}

export interface CallRoute {
  chainId: number;
  publisher: Address;
  callId: Hex;
  /** Present in a reveal link shared after the horizon. */
  opening: Pick<Opening, 'feed' | 'direction' | 'salt'> | null;
}

/** Web app route of a call's proof page: "#/call/<chainId>/<publisher>/<callId>". */
export function callRoute(chainId: number, publisher: Address, callId: Hex): string {
  return `#/call/${chainId}/${publisher}/${callId}`;
}

/**
 * A reveal link: the proof page route plus the opening in the URL fragment. Browsers never send the fragment to a
 * server, so the opening only reaches whoever opens the link. Share it only after the horizon.
 */
export function shareFragment(opening: Opening): string {
  const dir = opening.direction === UP ? 'up' : 'down';
  return `${callRoute(opening.chainId, opening.publisher, opening.callId)}?feed=${opening.feed}&dir=${dir}&salt=${opening.salt}`;
}

/** Parses "#/call/<chainId>/<publisher>/<callId>[?feed=..&dir=..&salt=..]"; null if it is not a call route. */
export function parseCallRoute(hash: string): CallRoute | null {
  const match = /^#?\/call\/(\d+)\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]{64})(?:\?(.*))?$/.exec(hash);
  if (!match) return null;
  const [, chain = '', publisher = '', callId = '', query] = match;
  const route: CallRoute = {
    chainId: Number(chain),
    publisher: requireAddress(publisher, 'publisher'),
    callId: requireBytes32(callId, 'callId'),
    opening: null,
  };
  if (query) {
    const params = new URLSearchParams(query);
    const feed = params.get('feed');
    const dir = params.get('dir');
    const salt = params.get('salt');
    if (feed && dir && salt) {
      route.opening = {
        feed: requireAddress(feed, 'feed'),
        direction: parseDirection(dir),
        salt: requireBytes32(salt, 'salt'),
      };
    }
  }
  return route;
}

const FILE_TYPE = 'proof-of-call-opening';

export function openingToJson(opening: Opening): string {
  return `${JSON.stringify(
    {
      type: FILE_TYPE,
      version: 1,
      chainId: opening.chainId,
      contract: opening.contract,
      publisher: opening.publisher,
      callId: opening.callId,
      feed: opening.feed,
      direction: opening.direction === UP ? 'up' : 'down',
      salt: opening.salt,
    },
    null,
    2,
  )}\n`;
}

export function parseOpeningJson(text: string): Opening {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('opening file is not valid JSON', { cause: err });
  }
  if (!isRecord(parsed) || parsed.type !== FILE_TYPE || parsed.version !== 1) {
    throw new Error('not a Proof of Call opening file (type/version)');
  }
  const direction = typeof parsed.direction === 'string' ? parseDirection(parsed.direction) : NaN;
  if (direction !== UP && direction !== DOWN) throw new Error('opening: invalid direction');
  return {
    chainId: requireInteger(parsed.chainId, 'chainId'),
    contract: requireAddress(parsed.contract, 'contract'),
    publisher: requireAddress(parsed.publisher, 'publisher'),
    callId: requireBytes32(parsed.callId, 'callId'),
    feed: requireAddress(parsed.feed, 'feed'),
    direction,
    salt: requireBytes32(parsed.salt, 'salt'),
  };
}

/** True if the opening hashes to the sealed commitment. */
export function openingMatches(opening: Opening, commitment: Hex): boolean {
  return computeCommitment(opening).toLowerCase() === commitment.toLowerCase();
}
