export const QIE_TESTNET_CHAIN_ID = 1983;
export const QIE_MAINNET_CHAIN_ID = 1990;
/** anvil's default chain id; only used for local tests and demos. */
export const LOCAL_CHAIN_ID = 31337;

export type NetworkKey = 'testnet' | 'mainnet' | 'local';

export const CHAIN_IDS: Record<NetworkKey, number> = {
  testnet: QIE_TESTNET_CHAIN_ID,
  mainnet: QIE_MAINNET_CHAIN_ID,
  local: LOCAL_CHAIN_ID,
};

/**
 * Public QIE RPC endpoints (docs.qie.digital, "Access Mainnet or Testnet"). On 1 Nov 2026 testnet rpc2, rpc4 and
 * rpc5 answered while rpc1 failed the TLS handshake (docs/DEPLOY.md), so rpc2 comes first.
 */
export const QIE_RPCS = {
  testnet: ['https://rpc2testnet.qie.digital/', 'https://rpc4testnet.qie.digital/', 'https://rpc5testnet.qie.digital/'],
  mainnet: ['https://rpc1mainnet.qie.digital/'],
} as const;

export const QIE_EXPLORERS = {
  testnet: 'https://testnet.qie.digital',
  mainnet: 'https://mainnet.qie.digital',
} as const;

export const NETWORK_NAMES: Record<NetworkKey, string> = {
  testnet: 'QIE Testnet',
  mainnet: 'QIE Mainnet',
  local: 'Local anvil',
};

export function networkKeyForChainId(chainId: number): NetworkKey | undefined {
  return (Object.keys(CHAIN_IDS) as NetworkKey[]).find((key) => CHAIN_IDS[key] === chainId);
}
