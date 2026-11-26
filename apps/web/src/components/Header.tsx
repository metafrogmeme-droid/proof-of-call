import type { NetworkInfo, NetworkKey } from '@proof-of-call/core';
import { useState } from 'react';
import { shortAddress } from '../format';
import { NETWORK_LIST } from '../networks';
import { href } from '../router';
import type { WalletState } from '../wallet';
import { AddressLink, CopyButton } from './common';

const SHORT_NAME: Record<NetworkKey, string> = { mainnet: 'Mainnet', testnet: 'Testnet', local: 'Local' };

function Mark() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#0c1814" stroke="#3ee0b0" strokeOpacity="0.5" />
      <path
        d="M9 16.5l4.5 4.5L23 11"
        fill="none"
        stroke="#3ee0b0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Header({ network, wallet }: { network: NetworkInfo | undefined; wallet: WalletState }) {
  const [choosing, setChoosing] = useState(false);
  const wrongChain = wallet.account && network && wallet.chainId !== network.chainId;
  const contract = network?.proofOfCall;
  return (
    <header className="header">
      <div className="header-inner">
        <a className="brand" href={network ? href.network(network.chainId) : '#/'}>
          <Mark />
          <span className="brand-text">
            <span className="brand-name">Proof of Call</span>
            <span className="brand-tag">RUNECLAW</span>
          </span>
        </a>
        <nav className="networks" aria-label="Network">
          <div className="net-seg">
            {NETWORK_LIST.map((n) => {
              const active = n.chainId === network?.chainId;
              return (
                <a
                  key={n.key}
                  href={href.network(n.chainId)}
                  className={active ? 'net active' : 'net'}
                  aria-current={active ? 'page' : undefined}
                >
                  {active ? (
                    <>
                      <span className="dot" aria-hidden="true" />
                      {n.name} <span className="net-id">· {n.chainId}</span>
                    </>
                  ) : (
                    SHORT_NAME[n.key]
                  )}
                </a>
              );
            })}
          </div>
          <a className="nav-link" href={href.about()}>
            How it works
          </a>
        </nav>
        {network && contract ? (
          <div className="contract-chip">
            <span className="kicker">Contract</span>
            <AddressLink network={network} address={contract.address} copy="Copy contract address" />
          </div>
        ) : null}
        <div className="wallet">
          {wallet.account ? (
            <>
              <span className="wallet-account">
                <span className={wrongChain ? 'dot dot-warn' : 'dot'} aria-hidden="true" />
                <code title={wallet.account}>{shortAddress(wallet.account)}</code>
                <CopyButton value={wallet.account} label="Copy wallet address" />
              </span>
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
      </div>
    </header>
  );
}
