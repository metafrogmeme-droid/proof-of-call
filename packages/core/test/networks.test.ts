import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feedByAddress, feedFor, loadNetworks, parseMainnet } from '../src/index.js';

const repo = new URL('../../../', import.meta.url);
const testnetRecord: unknown = JSON.parse(readFileSync(new URL('deployments/qie-testnet-1983.json', repo), 'utf8'));

const mainnetConfig = (status = 'verified') => ({
  chainId: 1990,
  rpc: 'https://rpc1mainnet.qie.digital/',
  explorer: 'https://mainnet.qie.digital',
  feeds: [
    { asset: 'BTC', pair: 'BTC / USD', address: '0x9E596d809a20A272c788726f592c0d1629755440', decimals: 8 },
    { asset: 'ETH', pair: 'ETH / USD', address: '0x4bb7012Fbc79fE4Ae9B664228977b442b385500d', decimals: 8 },
  ],
  feedVerification: { status },
});

const mainnetRecord = {
  chainId: 1990,
  rpc: 'https://rpc1mainnet.qie.digital/',
  explorer: 'https://mainnet.qie.digital',
  contracts: {
    ProofOfCall: { address: '0x1111111111111111111111111111111111111111', tx: `0x${'ab'.repeat(32)}`, block: 123 },
  },
  feeds: mainnetConfig().feeds,
};

describe('loadNetworks', () => {
  it('reads the committed testnet deployment record', () => {
    const { testnet } = loadNetworks({ testnet: testnetRecord });
    expect(testnet?.chainId).toBe(1983);
    expect(testnet?.proofOfCall).toEqual({
      address: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
      deployBlock: 9_507_635n,
      deployTx: '0xaa83a9b3a215f6a3ff86c6b7e0aea608c13e4ebc6fc17778f9c91d5832f1a574',
    });
    expect(testnet?.rpcUrls[0]).toBe('https://rpc2testnet.qie.digital/');
    expect(testnet?.feeds.map((f) => [f.asset, f.address, f.kind])).toEqual([
      ['BTC', '0xa1141220424Fc103d1631BAd44039CEc0C4B6D28', 'mock'],
      ['ETH', '0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82', 'mock'],
    ]);
    expect(testnet?.feedsVerified).toBe(true);
    if (!testnet) throw new Error('unreachable');
    expect(feedFor(testnet, 'ETH').pair).toBe('ETH / USD');
    expect(feedByAddress(testnet, '0xa1141220424fc103d1631bad44039cec0c4b6d28')?.asset).toBe('BTC');
  });

  it('shows mainnet as configured but not deployed until the record exists', () => {
    const { mainnet } = loadNetworks({ mainnetConfig: mainnetConfig() });
    expect(mainnet?.proofOfCall).toBeNull();
    expect(mainnet?.feeds.map((f) => f.kind)).toEqual(['qie-oracle', 'qie-oracle']);
    expect(mainnet?.feedsVerified).toBe(true);
    expect(parseMainnet(mainnetConfig('pending')).feedsVerified).toBe(false);
  });

  it('picks up the mainnet deployment record', () => {
    const mainnet = parseMainnet(mainnetConfig(), mainnetRecord);
    expect(mainnet.proofOfCall?.address).toBe('0x1111111111111111111111111111111111111111');
    expect(mainnet.proofOfCall?.deployBlock).toBe(123n);
  });

  it('refuses inconsistent or malformed files', () => {
    const otherFeeds = { ...mainnetRecord, feeds: [mainnetConfig().feeds[0]] };
    expect(() => parseMainnet(mainnetConfig(), otherFeeds)).toThrow(/other feeds/);
    expect(() => loadNetworks({ testnet: { ...(testnetRecord as object), chainId: 1990 } })).toThrow(/expected 1983/);
    expect(() => loadNetworks({ testnet: { chainId: 1983 } })).toThrow(/contracts/);
    expect(() => parseMainnet({ ...mainnetConfig(), chainId: 1 })).toThrow(/expected 1990/);
  });
});
