import type { NetworkInfo } from '@proof-of-call/core';
import { getAddress, toHex, type Address, type Hex } from 'viem';
import { useCallback, useEffect, useState } from 'react';

/** EIP-1193 provider as injected by browser wallets (MetaMask, QIE Wallet extension, Rabby, ...). */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: string | null;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Eip1193Provider;
}

/** Wallets announced through EIP-6963, plus window.ethereum as a fallback. No WalletConnect relay, no third parties. */
export function discoverWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>();
  const emit = () => {
    const list = [...found.values()];
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (list.length === 0 && injected)
      list.push({ id: 'injected', name: 'Browser wallet', icon: null, provider: injected });
    onChange(list);
  };
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    const icon = detail.info.icon?.startsWith('data:image/') ? detail.info.icon : null;
    found.set(detail.info.uuid, { id: detail.info.uuid, name: detail.info.name, icon, provider: detail.provider });
    emit();
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const timer = window.setTimeout(emit, 300);
  return () => {
    window.removeEventListener('eip6963:announceProvider', onAnnounce);
    window.clearTimeout(timer);
  };
}

export interface WalletState {
  wallets: WalletOption[];
  wallet: WalletOption | null;
  account: Address | null;
  chainId: number | null;
  error: string | null;
  connect: (option: WalletOption) => Promise<void>;
  disconnect: () => void;
  /** Asks the wallet to switch to (or add) the network. */
  switchTo: (network: NetworkInfo) => Promise<void>;
  /** Sends a prepared transaction from the connected account and returns its hash. */
  send: (tx: { to: Address; data: Hex }) => Promise<Hex>;
}

function message(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && err.code === 4001)
    return 'Request rejected in the wallet.';
  return err instanceof Error ? err.message : String(err);
}

export function addChainParameters(network: NetworkInfo) {
  return {
    chainId: toHex(network.chainId),
    chainName: network.name,
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: [...network.rpcUrls],
    ...(network.explorer ? { blockExplorerUrls: [network.explorer] } : {}),
  };
}

export function useWallet(): WalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [wallet, setWallet] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => discoverWallets(setWallets), []);

  useEffect(() => {
    const provider = wallet?.provider;
    if (!provider?.on) return undefined;
    const onAccounts = (...args: unknown[]) => {
      const list = args[0] as string[] | undefined;
      setAccount(list?.[0] ? getAddress(list[0]) : null);
    };
    const onChain = (...args: unknown[]) => {
      setChainId(Number(args[0]));
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [wallet]);

  const connect = useCallback(async (option: WalletOption) => {
    setError(null);
    try {
      const accounts = (await option.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const chain = Number(await option.provider.request({ method: 'eth_chainId' }));
      if (!accounts[0]) throw new Error('The wallet returned no account.');
      setWallet(option);
      setAccount(getAddress(accounts[0]));
      setChainId(chain);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setAccount(null);
    setChainId(null);
  }, []);

  const switchTo = useCallback(
    async (network: NetworkInfo) => {
      if (!wallet) return;
      setError(null);
      try {
        try {
          await wallet.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: toHex(network.chainId) }],
          });
        } catch (err) {
          if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 4902) {
            await wallet.provider.request({ method: 'wallet_addEthereumChain', params: [addChainParameters(network)] });
          } else {
            throw err;
          }
        }
        setChainId(Number(await wallet.provider.request({ method: 'eth_chainId' })));
      } catch (err) {
        setError(message(err));
      }
    },
    [wallet],
  );

  const send = useCallback(
    async (tx: { to: Address; data: Hex }) => {
      if (!wallet || !account) throw new Error('Connect a wallet first.');
      const hash = (await wallet.provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: tx.to, data: tx.data, value: '0x0' }],
      })) as Hex;
      return hash;
    },
    [wallet, account],
  );

  return { wallets, wallet, account, chainId, error, connect, disconnect, switchTo, send };
}
