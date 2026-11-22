import type { NetworkInfo } from '@proof-of-call/core';
import { createPublicClient, custom, defineChain, fallback, http, type PublicClient } from 'viem';
import type { Eip1193Provider } from './wallet';

export function chainOf(network: NetworkInfo) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: { default: { http: [...network.rpcUrls] } },
  });
}

/** Reads go to the public QIE RPCs, one after another on failure. */
export function rpcClient(network: NetworkInfo): PublicClient {
  return createPublicClient({
    chain: chainOf(network),
    transport: fallback(network.rpcUrls.map((url) => http(url, { retryCount: 1, timeout: 20_000 }))),
    ccipRead: false, // never follow an EIP-3668 OffchainLookup to an arbitrary URL
  });
}

/** Fallback when the RPC refuses cross-origin requests: read through the connected wallet's provider instead. */
export function walletClientForReads(network: NetworkInfo, provider: Eip1193Provider): PublicClient {
  return createPublicClient({ chain: chainOf(network), transport: custom(provider), ccipRead: false });
}

/** A browser fetch that fails before any HTTP status (CORS, offline, DNS). */
export function looksLikeNetworkBlock(err: unknown): boolean {
  const details = (err as { details?: unknown } | null)?.details;
  const text =
    err instanceof Error ? `${err.name} ${err.message} ${typeof details === 'string' ? details : ''}` : String(err);
  return /Failed to fetch|NetworkError|Load failed|CORS|HTTP request failed/i.test(text);
}
