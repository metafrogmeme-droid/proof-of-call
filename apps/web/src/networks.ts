import { loadNetworks, type NetworkInfo, type NetworkKey } from '@proof-of-call/core';

/** Networks compiled into this build (deployments/*.json). Local anvil only in dev and test builds. */
export const NETWORKS: Partial<Record<NetworkKey, NetworkInfo>> = loadNetworks(__POC_DEPLOYMENTS__);

export const NETWORK_LIST: NetworkInfo[] = (['mainnet', 'testnet', 'local'] as const).flatMap((k) => {
  const n = NETWORKS[k];
  return n ? [n] : [];
});

export function networkByChainId(chainId: number): NetworkInfo | undefined {
  return NETWORK_LIST.find((n) => n.chainId === chainId);
}

/** Mainnet once it is deployed, testnet before that. */
export function defaultNetwork(): NetworkInfo | undefined {
  return NETWORK_LIST.find((n) => n.key === 'mainnet' && n.proofOfCall) ?? NETWORKS.testnet ?? NETWORK_LIST[0];
}
