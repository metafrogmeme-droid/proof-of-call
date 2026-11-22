import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIN_IDS, loadNetworks, type DeploymentFiles, type NetworkInfo, type NetworkKey } from '@proof-of-call/core';
import { createPublicClient, defineChain, fallback, http, type Address, type Chain, type PublicClient } from 'viem';

export interface Ctx {
  network: NetworkInfo;
  chain: Chain;
  client: PublicClient;
  rpcUrl: string;
  /** ProofOfCall address (throws in openNetwork when the network has no deployment). */
  contract: Address;
}

/** deployments/ of this repository (packages/cli/dist -> ../../../deployments). */
export const DEFAULT_DEPLOYMENTS_DIR = fileURLToPath(new URL('../../../deployments/', import.meta.url));

function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined;
}

export function readDeploymentFiles(dir: string): DeploymentFiles {
  const files: DeploymentFiles = {};
  const testnet = readJson(join(dir, 'qie-testnet-1983.json'));
  const mainnetConfig = readJson(join(dir, 'qie-mainnet-1990.config.json'));
  const mainnetRecord = readJson(join(dir, 'qie-mainnet-1990.json'));
  const local = readJson(join(dir, 'local-31337.json'));
  if (testnet !== undefined) files.testnet = testnet;
  if (mainnetConfig !== undefined) files.mainnetConfig = mainnetConfig;
  if (mainnetRecord !== undefined) files.mainnetRecord = mainnetRecord;
  if (local !== undefined) files.local = local;
  return files;
}

export interface NetworkOptions {
  network: NetworkKey;
  rpc?: string | undefined;
  deploymentsDir?: string | undefined;
}

export function chainFor(network: NetworkInfo, rpcUrls: readonly string[]): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: { default: { http: [...rpcUrls] } },
    ...(network.explorer ? { blockExplorers: { default: { name: 'QIE explorer', url: network.explorer } } } : {}),
  });
}

/** Loads the network, connects to its RPC and checks that the RPC really is that chain. */
export async function openNetwork(opts: NetworkOptions): Promise<Ctx> {
  const dir = resolve(opts.deploymentsDir ?? DEFAULT_DEPLOYMENTS_DIR);
  const network = loadNetworks(readDeploymentFiles(dir))[opts.network];
  if (!network) throw new Error(`no ${opts.network} deployment found in ${dir}`);
  if (!network.proofOfCall) {
    throw new Error(`ProofOfCall is not deployed on ${network.name} yet (no deployment record in ${dir})`);
  }
  const rpcUrls = opts.rpc ? [opts.rpc] : network.rpcUrls;
  for (const url of rpcUrls) {
    if (!/^https?:\/\//.test(url)) throw new Error(`RPC must be an http(s) URL: ${url}`);
    if (opts.network !== 'local' && !url.startsWith('https://'))
      throw new Error(`use an https:// RPC for ${network.name}`);
  }
  const chain = chainFor(network, rpcUrls);
  const transport =
    rpcUrls.length === 1
      ? http(rpcUrls[0], { retryCount: 2 })
      : fallback(rpcUrls.map((u) => http(u, { retryCount: 1 })));
  const client = createPublicClient({ chain, transport });
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_IDS[opts.network]) {
    throw new Error(`the RPC answered chain id ${chainId}, expected ${CHAIN_IDS[opts.network]} (${network.name})`);
  }
  return { network, chain, client, rpcUrl: rpcUrls[0] ?? '', contract: network.proofOfCall.address };
}

export async function chainNow(ctx: Ctx): Promise<bigint> {
  return (await ctx.client.getBlock({ blockTag: 'latest' })).timestamp;
}
