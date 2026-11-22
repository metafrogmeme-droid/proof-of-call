import { buildIndex, resolveRevealers, syncEvents, type CallIndex, type NetworkInfo } from '@proof-of-call/core';
import type { Address, PublicClient } from 'viem';
import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeNetworkBlock, rpcClient, walletClientForReads } from './chain';
import { browserStore } from './storage';
import type { WalletState } from './wallet';

export interface NetworkData {
  status: 'loading' | 'ready' | 'error';
  index: CallIndex | null;
  /** Chain time (latest block timestamp), not the visitor's clock. */
  now: bigint | null;
  head: bigint | null;
  client: PublicClient | null;
  /** Where the data came from. */
  source: 'rpc' | 'wallet' | null;
  error: string | null;
  progress: string | null;
  refresh: () => void;
}

const revealers = new Map<string, Address>();

/** Loads every call of the network from chain events (cached per viewer) and keeps it fresh. */
export function useNetworkData(network: NetworkInfo | undefined, wallet: WalletState): NetworkData {
  type Loaded = Omit<NetworkData, 'refresh' | 'status'> & { chainId: number; status: 'ready' | 'error' };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);
  const walletRef = useRef(wallet);
  useEffect(() => {
    walletRef.current = wallet;
  });

  useEffect(() => {
    if (!network?.proofOfCall) return undefined;
    const controller = new AbortController();
    const chainId = network.chainId;
    const load = async (client: PublicClient, source: 'rpc' | 'wallet') => {
      const result = await syncEvents(client, network, browserStore(), {
        signal: controller.signal,
        onProgress: (done, total) => {
          setProgress(`reading blocks up to ${done} of ${total}`);
        },
      });
      const index = buildIndex(result.events);
      await resolveRevealers(client, index, revealers);
      const block = await client.getBlock({ blockTag: 'latest' });
      if (controller.signal.aborted) return;
      setLoaded({
        chainId,
        status: 'ready',
        index,
        now: block.timestamp,
        head: result.headBlock,
        client,
        source,
        error: null,
        progress: null,
      });
      setProgress(null);
    };
    load(rpcClient(network), 'rpc').catch(async (err: unknown) => {
      if (controller.signal.aborted) return;
      const w = walletRef.current;
      if (looksLikeNetworkBlock(err) && w.wallet && w.chainId === chainId) {
        try {
          await load(walletClientForReads(network, w.wallet.provider), 'wallet');
          return;
        } catch (inner) {
          err = inner;
        }
      }
      const hint = looksLikeNetworkBlock(err)
        ? ' The QIE RPC could not be reached from this browser. Connect a wallet on this network to read through it instead.'
        : '';
      const text = `${err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err)}.${hint}`;
      setLoaded((prev) =>
        prev?.chainId === chainId
          ? { ...prev, status: 'error', error: text }
          : {
              chainId,
              status: 'error',
              index: null,
              now: null,
              head: null,
              client: null,
              source: null,
              error: text,
              progress: null,
            },
      );
      setProgress(null);
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [network, tick, wallet.chainId]);

  // Data of another network is never shown under this one.
  if (!loaded || loaded.chainId !== network?.chainId) {
    return {
      status: 'loading',
      index: null,
      now: null,
      head: null,
      client: null,
      source: null,
      error: null,
      progress,
      refresh,
    };
  }
  return {
    status: loaded.status,
    index: loaded.index,
    now: loaded.now,
    head: loaded.head,
    client: loaded.client,
    source: loaded.source,
    error: loaded.error,
    progress,
    refresh,
  };
}
