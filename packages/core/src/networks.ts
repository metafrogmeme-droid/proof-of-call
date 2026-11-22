import type { Address, Hash } from 'viem';
import { CHAIN_IDS, NETWORK_NAMES, QIE_RPCS, type NetworkKey } from './chains.js';
import { isRecord, requireAddress, requireInteger, requireRecord, requireString } from './validate.js';

export type Asset = 'BTC' | 'ETH';
export const ASSETS: readonly Asset[] = ['BTC', 'ETH'];

export interface FeedInfo {
  asset: Asset;
  /** e.g. "BTC / USDT" (QIE Oracle on mainnet) or "BTC / USD" (our testnet mock) */
  pair: string;
  address: Address;
  decimals: number;
  /** QIE Oracle feed (mainnet) or our MockAggregatorV3 (testnet, local). */
  kind: 'qie-oracle' | 'mock';
}

export interface Deployment {
  address: Address;
  /** Block of the deploy transaction: event scans start here. */
  deployBlock: bigint;
  deployTx: Hash | null;
}

export interface NetworkInfo {
  key: NetworkKey;
  chainId: number;
  name: string;
  rpcUrls: readonly string[];
  explorer: string | null;
  /** null until ProofOfCall is deployed on this network. */
  proofOfCall: Deployment | null;
  feeds: readonly FeedInfo[];
  /** Mainnet: the feed addresses were checked against the QIE docs and the chain. Always true for our own mocks. */
  feedsVerified: boolean;
}

/** The JSON files under deployments/, as parsed objects. Missing files are simply left out. */
export interface DeploymentFiles {
  /** deployments/qie-testnet-1983.json */
  testnet?: unknown;
  /** deployments/qie-mainnet-1990.config.json */
  mainnetConfig?: unknown;
  /** deployments/qie-mainnet-1990.json (written after the owner's mainnet deploy) */
  mainnetRecord?: unknown;
  /** deployments/local-31337.json (local demo, never committed) */
  local?: unknown;
}

export function loadNetworks(files: DeploymentFiles): Partial<Record<NetworkKey, NetworkInfo>> {
  const out: Partial<Record<NetworkKey, NetworkInfo>> = {};
  if (files.testnet !== undefined) out.testnet = parseDeploymentRecord(files.testnet, 'testnet');
  if (files.mainnetConfig !== undefined) out.mainnet = parseMainnet(files.mainnetConfig, files.mainnetRecord);
  if (files.local !== undefined) out.local = parseDeploymentRecord(files.local, 'local');
  return out;
}

function assetOf(pair: string): Asset | undefined {
  const base = pair.split('/')[0]?.trim();
  return ASSETS.find((a) => a === base);
}

function dedupe(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

function parseProofOfCall(contracts: Record<string, unknown>, where: string): Deployment {
  const poc = requireRecord(contracts.ProofOfCall, `${where}.contracts.ProofOfCall`);
  const deployTx = typeof poc.tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(poc.tx) ? (poc.tx as Hash) : null;
  return {
    address: requireAddress(poc.address, `${where}.contracts.ProofOfCall.address`),
    deployBlock: BigInt(requireInteger(poc.block, `${where}.contracts.ProofOfCall.block`)),
    deployTx,
  };
}

function parseFeedList(value: unknown, where: string, kind: FeedInfo['kind']): FeedInfo[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected a list of feeds`);
  return value.flatMap((item, i): FeedInfo[] => {
    const f = requireRecord(item, `${where}[${i}]`);
    const pair = requireString(f.pair, `${where}[${i}].pair`);
    const asset = assetOf(pair);
    if (!asset) return [];
    const decimals = f.decimals === undefined ? 8 : requireInteger(f.decimals, `${where}[${i}].decimals`);
    return [{ asset, pair, address: requireAddress(f.address, `${where}[${i}].address`), decimals, kind }];
  });
}

/** A record shaped like deployments/qie-testnet-1983.json (also used for local anvil deployments). */
export function parseDeploymentRecord(record: unknown, key: NetworkKey): NetworkInfo {
  const where = `deployments (${key})`;
  const r = requireRecord(record, where);
  const chainId = requireInteger(r.chainId, `${where}.chainId`);
  if (chainId !== CHAIN_IDS[key]) throw new Error(`${where}.chainId: ${chainId}, expected ${CHAIN_IDS[key]}`);
  const contracts = requireRecord(r.contracts, `${where}.contracts`);
  const rpc = requireString(r.rpc, `${where}.rpc`);

  let feeds: FeedInfo[];
  if (r.feeds !== undefined) {
    feeds = parseFeedList(r.feeds, `${where}.feeds`, key === 'mainnet' ? 'qie-oracle' : 'mock');
  } else {
    feeds = Object.entries(contracts).flatMap(([name, value]): FeedInfo[] => {
      if (!name.startsWith('MockAggregatorV3 ') || !isRecord(value)) return [];
      const pair = name.slice('MockAggregatorV3 '.length);
      const asset = assetOf(pair);
      if (!asset) return [];
      const decimals = value.decimals === undefined ? 8 : requireInteger(value.decimals, `${where}.${name}.decimals`);
      return [
        { asset, pair, address: requireAddress(value.address, `${where}.${name}.address`), decimals, kind: 'mock' },
      ];
    });
  }

  const defaults = key === 'local' ? [] : QIE_RPCS[key];
  return {
    key,
    chainId,
    name: NETWORK_NAMES[key],
    rpcUrls: dedupe([rpc, ...defaults]),
    explorer: typeof r.explorer === 'string' && r.explorer.length > 0 ? r.explorer.replace(/\/$/, '') : null,
    proofOfCall: parseProofOfCall(contracts, where),
    feeds,
    feedsVerified: key !== 'mainnet',
  };
}

/** Mainnet: the config file always exists; the deployment record only after the owner's deploy. */
export function parseMainnet(config: unknown, record?: unknown): NetworkInfo {
  const where = 'deployments/qie-mainnet-1990.config.json';
  const c = requireRecord(config, where);
  const chainId = requireInteger(c.chainId, `${where}.chainId`);
  if (chainId !== CHAIN_IDS.mainnet) throw new Error(`${where}.chainId: ${chainId}, expected ${CHAIN_IDS.mainnet}`);
  const feeds = parseFeedList(c.feeds, `${where}.feeds`, 'qie-oracle');
  const verification = isRecord(c.feedVerification) ? c.feedVerification : {};

  let proofOfCall: Deployment | null = null;
  if (record !== undefined) {
    const deployed = parseDeploymentRecord(record, 'mainnet');
    const configured = feeds.map((f) => f.address).join(',');
    const recorded = deployed.feeds.map((f) => f.address).join(',');
    if (deployed.feeds.length > 0 && configured !== recorded) {
      throw new Error('deployments/qie-mainnet-1990.json lists other feeds than the mainnet config');
    }
    proofOfCall = deployed.proofOfCall;
  }
  return {
    key: 'mainnet',
    chainId,
    name: NETWORK_NAMES.mainnet,
    rpcUrls: dedupe([requireString(c.rpc, `${where}.rpc`), ...QIE_RPCS.mainnet]),
    explorer: requireString(c.explorer, `${where}.explorer`).replace(/\/$/, ''),
    proofOfCall,
    feeds,
    feedsVerified: verification.status === 'verified',
  };
}

export function feedFor(network: NetworkInfo, asset: Asset): FeedInfo {
  const feed = network.feeds.find((f) => f.asset === asset);
  if (!feed) throw new Error(`${network.name} has no ${asset} feed`);
  return feed;
}

export function feedByAddress(network: NetworkInfo, address: Address): FeedInfo | undefined {
  return network.feeds.find((f) => f.address.toLowerCase() === address.toLowerCase());
}

export function explorerUrl(network: NetworkInfo, kind: 'address' | 'tx', value: string): string | null {
  return network.explorer ? `${network.explorer}/${kind}/${value}` : null;
}
