import { explorerUrl, type CallStatus, type NetworkInfo } from '@proof-of-call/core';
import type { Address } from 'viem';
import type { ReactNode } from 'react';
import { shortAddress } from '../format';
import { href } from '../router';

const STATUS_TEXT: Record<CallStatus, string> = {
  WAITING: 'Sealed, waiting',
  REVEALABLE: 'Ready to reveal',
  EXPIRABLE: 'Not revealed in time',
  HIT: 'Hit',
  MISS: 'Miss',
  FLAT: 'Flat',
  VOID: 'Void',
  EXPIRED: 'Expired (miss)',
};

export function StatusBadge({ status }: { status: CallStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_TEXT[status]}</span>;
}

export function ExternalLink({ url, children }: { url: string | null; children: ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function AddressLink({ network, address, label }: { network: NetworkInfo; address: Address; label?: string }) {
  return (
    <ExternalLink url={explorerUrl(network, 'address', address)}>
      <code title={address}>{label ?? shortAddress(address)}</code>
    </ExternalLink>
  );
}

export function TxLink({ network, hash }: { network: NetworkInfo; hash: string }) {
  return (
    <ExternalLink url={explorerUrl(network, 'tx', hash)}>
      <code title={hash}>{shortAddress(hash)}</code>
    </ExternalLink>
  );
}

export function PublisherLink({ network, publisher }: { network: NetworkInfo; publisher: Address }) {
  return (
    <a href={href.publisher(network.chainId, publisher)}>
      <code title={publisher}>{shortAddress(publisher)}</code>
    </a>
  );
}

/** Shown on every page: what is public and what is not. */
export function PublicNotice() {
  return (
    <aside className="notice" aria-label="What is public">
      <strong>Everything here is public on the QIE blockchain.</strong> A sealed call shows only a hash: its asset and
      direction stay hidden. Once a call is revealed, its asset, direction, prices and outcome are public for good. This
      page reads the chain directly in your browser: no accounts, no server, no tracking.
    </aside>
  );
}

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <p className="muted" role="status">
      {text}
    </p>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <p className="error" role="alert">
      {text}
    </p>
  );
}
