import type { NetworkInfo } from '@proof-of-call/core';
import { useState } from 'react';
import { shortAddress } from '../format';
import { NETWORK_LIST } from '../networks';
import { href } from '../router';
import type { WalletState } from '../wallet';

export function Header({ network, wallet }: { network: NetworkInfo | undefined; wallet: WalletState }) {
  const [choosing, setChoosing] = useState(false);
  const wrongChain = wallet.account && network && wallet.chainId !== network.chainId;
  return (
    <header className="header">
      <a className="brand" href={network ? href.network(network.chainId) : '#/'}>
        <span className="logo" aria-hidden="true">
          ✓
        </span>
        Proof of Call
      </a>
      <nav className="networks" aria-label="Network">
        {NETWORK_LIST.map((n) => (
          <a
            key={n.key}
            href={href.network(n.chainId)}
            className={n.chainId === network?.chainId ? 'active' : undefined}
            aria-current={n.chainId === network?.chainId ? 'page' : undefined}
          >
            {n.key === 'mainnet' ? 'Mainnet' : n.key === 'testnet' ? 'Testnet' : 'Local'}
          </a>
        ))}
        <a href={href.about()}>How it works</a>
      </nav>
      <div className="wallet">
        {wallet.account ? (
          <>
            <code title={wallet.account}>{shortAddress(wallet.account)}</code>
            {wrongChain ? (
              <button type="button" onClick={() => void wallet.switchTo(network)}>
                Switch to {network.name}
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={wallet.disconnect}>
              Disconnect
            </button>
          </>
        ) : choosing ? (
          wallet.wallets.length === 0 ? (
            <span className="muted">No browser wallet found</span>
          ) : (
            wallet.wallets.map((w) => (
              <button
                type="button"
                key={w.id}
                onClick={() => {
                  setChoosing(false);
                  void wallet.connect(w);
                }}
              >
                {w.icon ? <img src={w.icon} alt="" width={16} height={16} /> : null} {w.name}
              </button>
            ))
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              setChoosing(true);
            }}
          >
            Connect wallet
          </button>
        )}
      </div>
      {wallet.error ? (
        <p className="error header-error" role="alert">
          {wallet.error}
        </p>
      ) : null}
    </header>
  );
}
