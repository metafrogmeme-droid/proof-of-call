// @vitest-environment jsdom
import {
  buildIndex,
  computeCommitment,
  deserializeEvents,
  labelToCallId,
  UP,
  type CallIndex,
  type NetworkInfo,
  type SealedEvent,
} from '@proof-of-call/core';
import { cleanup, render, screen } from '@testing-library/react';
import type { Address, Hex, PublicClient } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import fixtureJson from '../../../packages/core/test/fixtures/local-anvil-events.json';
import { PublicNotice } from '../src/components/common';
import type { NetworkData } from '../src/data';
import { CallPage } from '../src/pages/CallPage';
import { NetworkPage } from '../src/pages/NetworkPage';
import { PublisherPage } from '../src/pages/PublisherPage';
import type { WalletState } from '../src/wallet';

afterEach(cleanup);

interface Fixture {
  contract: Address;
  deployBlock: string;
  now: string;
  publisher: Address;
  verifier: Address;
  feeds: { BTC: Address; ETH: Address };
  revealers: Record<string, Address>;
  events: unknown[];
}
const fixture = fixtureJson as unknown as Fixture;

const network: NetworkInfo = {
  key: 'local',
  chainId: 31337,
  name: 'Local anvil',
  rpcUrls: ['http://127.0.0.1:8545'],
  explorer: null,
  proofOfCall: { address: fixture.contract, deployBlock: BigInt(fixture.deployBlock), deployTx: null },
  feeds: [
    { asset: 'BTC', pair: 'BTC / USD', address: fixture.feeds.BTC, decimals: 8, kind: 'mock' },
    { asset: 'ETH', pair: 'ETH / USD', address: fixture.feeds.ETH, decimals: 8, kind: 'mock' },
  ],
  feedsVerified: true,
};

const client = {
  readContract: () => Promise.resolve({ sealedCalls: 5n, hits: 1n, misses: 2n, flats: 1n, voids: 1n, expiries: 1n }),
  getTransaction: () => Promise.reject(new Error('offline test')),
} as unknown as PublicClient;

function dataFor(index: CallIndex, now: bigint): NetworkData {
  return {
    status: 'ready',
    index,
    now,
    head: 100n,
    client,
    source: 'rpc',
    error: null,
    progress: null,
    refresh: () => undefined,
  };
}

const noWallet: WalletState = {
  wallets: [],
  wallet: null,
  account: null,
  chainId: null,
  error: null,
  connect: () => Promise.resolve(),
  disconnect: () => undefined,
  switchTo: () => Promise.resolve(),
  send: () => Promise.reject(new Error('no wallet')),
};

const recorded = buildIndex(deserializeEvents(fixture.events));
for (const c of recorded.calls.values())
  if (c.revealed) c.revealed.revealer = fixture.revealers[c.revealed.tx.toLowerCase()] ?? null;
const NOW = BigInt(fixture.now);

describe('network overview', () => {
  it('lists the publisher with the scorecard and the latest calls', () => {
    render(<NetworkPage network={network} data={dataFor(recorded, NOW)} />);
    expect(screen.getByText('Proof of Call on Local anvil')).toBeTruthy();
    expect(screen.getByText('Verifier wallets').previousElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Sealed calls').previousElementSibling?.textContent).toBe('5');
    const row = screen.getAllByRole('row')[1];
    expect(row?.textContent).toContain('33.3 %');
    expect(screen.getByText('RC-0003')).toBeTruthy();
    expect(screen.getAllByText('Hit').length).toBeGreaterThan(0);
  });

  it('says when a network is not deployed yet', () => {
    render(<NetworkPage network={{ ...network, proofOfCall: null }} data={dataFor(recorded, NOW)} />);
    expect(screen.getByText(/not deployed yet/)).toBeTruthy();
  });
});

describe('publisher scorecard', () => {
  it('shows the scorecard, confirms it against the contract and lists verifiers', async () => {
    render(<PublisherPage network={network} data={dataFor(recorded, NOW)} publisher={fixture.publisher} />);
    expect(await screen.findByText(/Matches the contract's own scorecard\(\)/)).toBeTruthy();
    expect(screen.getByText('Calls (5)')).toBeTruthy();
    expect(screen.getByText('Verifier wallets (1)')).toBeTruthy();
    expect(screen.getByText(/1 reveal, 1 expiry/)).toBeTruthy();
  });
});

describe('proof page', () => {
  it('shows a revealed call with prices, outcome and the verifier badge', async () => {
    const flat = [...recorded.calls.values()].find((c) => c.label === 'RC-0003');
    if (!flat) throw new Error('fixture changed');
    render(
      <CallPage
        network={network}
        data={dataFor(recorded, NOW)}
        route={{ chainId: 31337, publisher: flat.publisher, callId: flat.callId, opening: null }}
        wallet={noWallet}
      />,
    );
    expect(screen.getByText('FLAT')).toBeTruthy();
    expect(screen.getByText(/65,000\.00/)).toBeTruthy();
    expect(screen.getByText('verifier')).toBeTruthy();
    expect(await screen.findByText(/offline test/)).toBeTruthy(); // the in-browser re-check ran
  });

  // A synthetic open call whose opening we know.
  const callId = labelToCallId('WEB-1');
  const salt: Hex = `0x${'5c'.repeat(32)}`;
  const contract = fixture.contract;
  const commitment = computeCommitment({
    chainId: 31337,
    contract,
    publisher: fixture.publisher,
    callId,
    feed: fixture.feeds.BTC,
    direction: UP,
    salt,
  });
  const sealed: SealedEvent = {
    kind: 'Sealed',
    block: 50n,
    logIndex: 0,
    tx: `0x${'77'.repeat(32)}`,
    publisher: fixture.publisher,
    callId,
    commitment,
    sealedAt: 1_000_000n,
    horizon: 14_400n,
    revealBy: 1_000_000n + 14_400n + 21_600n + 86_400n,
    maxGap: 21_600,
    flatBandBps: 10,
  };
  const open = buildIndex([sealed]);
  const route = (s: Hex) => ({
    chainId: 31337,
    publisher: fixture.publisher,
    callId,
    opening: { feed: fixture.feeds.BTC, direction: UP, salt: s } as const,
  });

  it('keeps the asset and direction hidden while waiting', () => {
    render(
      <CallPage
        network={network}
        data={dataFor(open, 1_000_100n)}
        route={{ ...route(salt), opening: null }}
        wallet={noWallet}
      />,
    );
    expect(screen.getByText('Sealed, waiting')).toBeTruthy();
    expect(screen.getByText(/asset and the direction of this call are hidden/)).toBeTruthy();
    expect(screen.queryByText('Reveal this call')).toBeNull();
  });

  it('accepts a matching opening from a reveal link and says that revealing makes the call public', () => {
    render(<CallPage network={network} data={dataFor(open, 1_014_401n)} route={route(salt)} wallet={noWallet} />);
    expect(screen.getByText('Ready to reveal')).toBeTruthy();
    expect(screen.getByText(/Revealing makes this call public for good/)).toBeTruthy();
    expect(screen.getByText(/The opening matches the sealed commitment: BTC UP/)).toBeTruthy();
    expect(screen.getByText(/Connect a wallet/)).toBeTruthy();
  });

  it('rejects an opening that does not match', () => {
    render(
      <CallPage
        network={network}
        data={dataFor(open, 1_014_401n)}
        route={route(`0x${'5d'.repeat(32)}`)}
        wallet={noWallet}
      />,
    );
    expect(screen.getByText(/does not match the sealed commitment/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });

  it('offers to expire a call after its deadline, as a miss', () => {
    const wallet: WalletState = { ...noWallet, account: fixture.verifier, chainId: 31337 };
    render(
      <CallPage
        network={network}
        data={dataFor(open, sealed.revealBy + 1n)}
        route={{ ...route(salt), opening: null }}
        wallet={wallet}
      />,
    );
    expect(screen.getByText('Not revealed in time')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expire (counts as a miss)' })).toBeTruthy();
  });
});

it('the public notice says what is public', () => {
  render(<PublicNotice />);
  expect(screen.getByText(/Everything here is public on the QIE blockchain/)).toBeTruthy();
  expect(screen.getByLabelText('What is public').textContent).toMatch(
    /Once a call is revealed, its asset, direction, prices and outcome are public for good/,
  );
});
