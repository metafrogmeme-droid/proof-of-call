import { explorerUrl, type CallStatus, type NetworkInfo } from '@proof-of-call/core';
import type { Address } from 'viem';
import { useEffect, useState, type ReactNode } from 'react';
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 3.6V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Copies a full value (address, hash, command) that the page only shows truncated. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No clipboard access (insecure context or denied): the full value stays available in the title.
    }
  };
  const text = copied ? 'Copied' : label;
  return (
    <button
      type="button"
      className={copied ? 'icon-btn copied' : 'icon-btn'}
      aria-label={text}
      title={text}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** A long hex value, truncated, with the full value in the title and a copy button. */
export function Hash({ value, label }: { value: string; label: string }) {
  return (
    <span className="hash">
      <code title={value}>{shortAddress(value)}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

export function AddressLink({
  network,
  address,
  label,
  copy,
}: {
  network: NetworkInfo;
  address: Address;
  label?: string;
  /** Label of a copy button next to the link; no button without it. */
  copy?: string;
}) {
  const link = (
    <ExternalLink url={explorerUrl(network, 'address', address)}>
      <code title={address}>{label ?? shortAddress(address)}</code>
    </ExternalLink>
  );
  if (!copy) return link;
  return (
    <span className="addr">
      {link}
      <CopyButton value={address} label={copy} />
    </span>
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

/** A command line in a terminal block: never reflowed as prose, copyable in one click. */
export function Terminal({ title, command, copyLabel }: { title: string; command: string; copyLabel: string }) {
  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="terminal-title">{title}</span>
        <CopyButton value={command} label={copyLabel} />
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
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
    <p className="loading muted" role="status">
      <span className="loading-dot" aria-hidden="true" />
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
