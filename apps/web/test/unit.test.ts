import { describe, expect, it } from 'vitest';
import { movePercent, percent, price, relative, shortAddress, utc } from '../src/format';
import { defaultNetwork, NETWORK_LIST } from '../src/networks';
import { parseRoute } from '../src/router';

const P = '0x020A4366595292aa16184536bAB2E9949d0D925F';
const ID = `0x${'52432d30303031'.padEnd(64, '0')}`;

describe('routes', () => {
  it('parses every page', () => {
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#/')).toEqual({ page: 'home' });
    expect(parseRoute('#/about')).toEqual({ page: 'about' });
    expect(parseRoute('#/net/1983')).toEqual({ page: 'network', chainId: 1983 });
    expect(parseRoute(`#/publisher/1983/${P.toLowerCase()}`)).toEqual({
      page: 'publisher',
      chainId: 1983,
      publisher: P,
    });
    expect(parseRoute(`#/call/1983/${P}/${ID}`)).toMatchObject({
      page: 'call',
      route: { chainId: 1983, publisher: P, callId: ID, opening: null },
    });
  });

  it('reads the opening of a reveal link and refuses broken ones', () => {
    const salt = `0x${'ab'.repeat(32)}`;
    const route = parseRoute(
      `#/call/1983/${P}/${ID}?feed=0xa1141220424Fc103d1631BAd44039CEc0C4B6D28&dir=up&salt=${salt}`,
    );
    expect(route).toMatchObject({ page: 'call', route: { opening: { direction: 1, salt } } });
    expect(parseRoute(`#/call/1983/${P}/${ID}?feed=0x12&dir=up&salt=${salt}`).page).toBe('not-found');
    expect(parseRoute('#/publisher/1983/0x12').page).toBe('not-found');
    expect(parseRoute('#/elsewhere').page).toBe('not-found');
  });
});

describe('formatting', () => {
  it('formats addresses, times, prices and moves', () => {
    expect(shortAddress(P)).toBe('0x020A…925F');
    expect(utc(1_800_000_000n)).toBe('2027-01-15 08:00:00 UTC');
    expect(relative(1_000n, 4_600n)).toBe('1h ago');
    expect(relative(4_600n, 1_000n)).toBe('in 1h');
    expect(relative(5n, 5n)).toBe('now');
    expect(price(6_543_210_000_000n)).toBe('65,432.10');
    expect(price(300_000_000_000n)).toBe('3,000.00');
    expect(movePercent(6_500_000_000_000n, 6_600_000_000_000n)).toBe('+1.53 %');
    expect(movePercent(6_600_000_000_000n, 6_500_000_000_000n)).toBe('-1.51 %');
    expect(movePercent(100n, 100n)).toBe('0.00 %');
    expect(percent(1 / 3)).toBe('33.3 %');
    expect(percent(null)).toBe('n/a');
  });
});

describe('networks in this build', () => {
  it('contains the testnet deployment and defaults to it while mainnet is not deployed', () => {
    expect(NETWORK_LIST.map((n) => n.key)).toEqual(['testnet']);
    expect(defaultNetwork()?.chainId).toBe(1983);
  });
});
