import { callStatus, publisherStats, verifierWallets, type NetworkInfo } from '@proof-of-call/core';
import { AddressLink, Card, ErrorBox, Loading, PublisherLink, StatusBadge } from '../components/common';
import type { NetworkData } from '../data';
import { percent, relative, utc } from '../format';
import { callHref } from './links';

export function NetworkPage({ network, data }: { network: NetworkInfo; data: NetworkData }) {
  const deployment = network.proofOfCall;
  if (!deployment) {
    return (
      <Card title={`${network.name}: not deployed yet`}>
        <p>ProofOfCall is not deployed on {network.name} yet. Its feeds will be the official QIE Oracle feeds:</p>
        <FeedList network={network} />
      </Card>
    );
  }
  const index = data.index;
  const stats = index ? publisherStats(index) : [];
  const verifiers = index ? verifierWallets(index) : [];
  const calls = index ? [...index.calls.values()].sort((a, b) => (a.sealed.block > b.sealed.block ? -1 : 1)) : [];
  const revealed = calls.filter((c) => c.revealed).length;
  return (
    <>
      <Card title={`Proof of Call on ${network.name}`}>
        <p className="lead">
          Calls are sealed on chain as a hash before their outcome is known, then revealed and scored by the contract
          against the {network.key === 'mainnet' ? 'QIE Oracle' : 'feed'} prices. Nobody can edit, drop or cherry-pick
          them.
        </p>
        <dl className="facts">
          <dt>Contract</dt>
          <dd>
            <AddressLink network={network} address={deployment.address} label={deployment.address} />
          </dd>
          <dt>Chain</dt>
          <dd>
            {network.name} (chain id {network.chainId}), deployed in block {deployment.deployBlock.toString()}
          </dd>
          <dt>Feeds</dt>
          <dd>
            <FeedList network={network} />
          </dd>
        </dl>
        {network.key === 'testnet' ? (
          <p className="muted">
            Testnet has no oracle contracts, so its feeds are test mocks whose prices are pushed by the deployer.
            Mainnet uses the real QIE Oracle feeds.
          </p>
        ) : network.key === 'local' ? (
          <p className="muted">A local test chain with mock feeds, for development and demos.</p>
        ) : null}
      </Card>

      {data.status === 'loading' ? <Loading text={data.progress ?? 'Reading calls from the chain…'} /> : null}
      {data.error ? <ErrorBox text={data.error} /> : null}

      {index ? (
        <>
          <div className="stats">
            <Stat label="Sealed calls" value={calls.length} />
            <Stat label="Revealed" value={revealed} />
            <Stat label="Publishers" value={stats.length} />
            <Stat label="Verifier wallets" value={verifiers.length} />
          </div>

          <Card title="Publishers">
            {stats.length === 0 ? (
              <p className="muted">No calls sealed on this network yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Publisher</th>
                      <th>Sealed</th>
                      <th>Hit</th>
                      <th>Miss</th>
                      <th>Flat</th>
                      <th>Void</th>
                      <th>Open</th>
                      <th title="hits / (hits + misses)">Hit rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.publisher}>
                        <td>
                          <PublisherLink network={network} publisher={s.publisher} />
                        </td>
                        <td>{s.card.sealedCalls.toString()}</td>
                        <td>{s.card.hits.toString()}</td>
                        <td>
                          {s.card.misses.toString()}
                          {s.card.expiries > 0n ? (
                            <span className="muted"> ({s.card.expiries.toString()} expired)</span>
                          ) : null}
                        </td>
                        <td>{s.card.flats.toString()}</td>
                        <td>{s.card.voids.toString()}</td>
                        <td>{s.open}</td>
                        <td>{percent(s.hitRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {calls.length > 0 && data.now !== null ? (
            <Card title="Latest calls">
              <ul className="call-list">
                {calls.slice(0, 25).map((c) => (
                  <li key={c.key}>
                    <a href={callHref(network, c)}>{c.label ?? c.callId.slice(0, 10)}</a>{' '}
                    <StatusBadge status={callStatus(c, data.now ?? 0n)} />{' '}
                    <span className="muted">
                      by <PublisherLink network={network} publisher={c.publisher} />, sealed{' '}
                      {relative(c.sealed.sealedAt, data.now ?? 0n)} ({utc(c.sealed.sealedAt)})
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {index.anomalies.length > 0 ? (
            <Card title="Unexpected events">
              <ul>
                {index.anomalies.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function FeedList({ network }: { network: NetworkInfo }) {
  return (
    <ul className="plain">
      {network.feeds.map((f) => (
        <li key={f.address}>
          {f.pair} <AddressLink network={network} address={f.address} />{' '}
          <span className="muted">{f.kind === 'qie-oracle' ? 'QIE Oracle' : 'test mock'}</span>
        </li>
      ))}
    </ul>
  );
}
