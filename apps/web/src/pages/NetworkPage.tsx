import { publisherStats, verifierWallets, type NetworkInfo } from '@proof-of-call/core';
import { useId, useState } from 'react';
import { AddressLink, Card, ErrorBox, Loading, PublisherLink, Terminal } from '../components/common';
import type { NetworkData } from '../data';
import { percent } from '../format';
import { href } from '../router';
import { CallLedger } from './CallLedger';

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
      <div className="overview">
        <div className="overview-main">
          <section className="card hero">
            <p className="kicker kicker-accent">On-chain track record</p>
            <h1 className="page-title">{`Proof of Call on ${network.name}`}</h1>
            <p className="lead">
              Calls are sealed on chain as a hash before their outcome is known, then revealed and scored by the
              contract against the {network.key === 'mainnet' ? 'QIE Oracle' : 'feed'} prices. Nobody can edit, drop or
              cherry-pick them.
            </p>
            <dl className="facts">
              <dt>Contract</dt>
              <dd>
                <AddressLink network={network} address={deployment.address} copy="Copy contract address" />
              </dd>
              <dt>Chain</dt>
              <dd>
                {network.name} <span className="muted">· chain id</span> <code>{network.chainId}</code>{' '}
                <span className="muted">· deployed in block</span> <code>{deployment.deployBlock.toString()}</code>
              </dd>
              <dt>Feeds</dt>
              <dd>
                <FeedList network={network} />
              </dd>
            </dl>
            {network.key === 'testnet' ? (
              <p className="muted note">
                Testnet has no oracle contracts, so its feeds are test mocks whose prices are pushed by the deployer.
                Mainnet uses the real QIE Oracle feeds.
              </p>
            ) : network.key === 'local' ? (
              <p className="muted note">A local test chain with mock feeds, for development and demos.</p>
            ) : null}
          </section>
          <SealCard network={network} />
        </div>

        <div className="overview-side">
          {data.status === 'loading' && !index ? (
            <div className="stats" aria-hidden="true">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : null}
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

              <Card title="Latest calls">
                {calls.length === 0 ? (
                  <p className="muted">
                    No calls sealed on this network yet. The first one shows up here as soon as it is sealed.
                  </p>
                ) : data.now !== null ? (
                  <CallLedger network={network} calls={calls.slice(0, 25)} now={data.now} column="publisher" />
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </div>

      {index ? (
        <>
          <Card title="Publishers">
            {stats.length === 0 ? (
              <p className="muted">No publishers yet.</p>
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
    <ul className="feeds">
      {network.feeds.map((f) => (
        <li key={f.address} className="feed">
          <span className="feed-pair">{f.pair}</span>
          <AddressLink network={network} address={f.address} copy={`Copy ${f.pair} feed address`} />
          <span className={`pill pill-${f.kind}`}>{f.kind === 'qie-oracle' ? 'QIE Oracle' : 'test mock'}</span>
        </li>
      ))}
    </ul>
  );
}

type Direction = 'up' | 'down';
type Horizon = '4h' | '12h';

/**
 * Shows what sealing a call takes: the publisher's CLI command for a pair, direction and horizon. Presentation only:
 * sealing stays in the CLI, where the salt is drawn and kept until the reveal. Nothing here is signed or sent.
 */
function SealCard({ network }: { network: NetworkInfo }) {
  const id = useId();
  const feeds = network.feeds;
  const [asset, setAsset] = useState(feeds[0]?.asset ?? 'BTC');
  const [direction, setDirection] = useState<Direction>('up');
  const [horizon, setHorizon] = useState<Horizon>('4h');
  const feed = feeds.find((f) => f.asset === asset);
  const command = [
    'npm run -s poc -- seal \\',
    `  --network ${network.key} --asset ${asset} \\`,
    `  --direction ${direction} --horizon ${horizon} \\`,
    '  --from <your address>',
  ].join('\n');
  return (
    <section className="card seal" aria-labelledby={`${id}-title`}>
      <div className="card-head">
        <div>
          <p className="kicker">For publishers</p>
          <h2 id={`${id}-title`}>Seal a Call</h2>
        </div>
        <span className="pill pill-accent">CLI · your wallet</span>
      </div>
      <p className="seal-intro">
        Commit to a call before the market moves. Only its hash goes on chain; the asset and direction stay hidden until
        the reveal.
      </p>
      <div className="seal-controls">
        {feeds.length > 0 ? (
          <Segmented
            legend="Pair"
            name={`${id}-pair`}
            options={feeds.map((f) => ({ value: f.asset, label: f.pair }))}
            value={asset}
            onChange={setAsset}
          />
        ) : null}
        <Segmented<Direction>
          legend="Direction"
          name={`${id}-direction`}
          options={[
            { value: 'up', label: 'UP' },
            { value: 'down', label: 'DOWN' },
          ]}
          value={direction}
          onChange={setDirection}
        />
        <Segmented<Horizon>
          legend="Horizon"
          name={`${id}-horizon`}
          options={[
            { value: '4h', label: '4 h' },
            { value: '12h', label: '12 h' },
          ]}
          value={horizon}
          onChange={setHorizon}
        />
      </div>
      <p className="seal-summary">
        <strong>
          {asset} {direction.toUpperCase()}
        </strong>{' '}
        over {horizon === '4h' ? '4 hours' : '12 hours'}, scored against the {feed?.pair ?? asset}{' '}
        {feed?.kind === 'qie-oracle' ? 'QIE Oracle' : 'test'} feed at the first price after the horizon.
      </p>
      <Terminal title="Publisher terminal" command={command} copyLabel="Copy command" />
      <p className="hint">
        Only the contract's allowlisted feeds ({feeds.map((f) => f.pair).join(', ')}) can be sealed, with a horizon of 4
        h or 12 h.
      </p>
      <p className="seal-foot">
        Publishers seal with the open-source command line tool from their own wallet; the salt stays on their machine
        until the reveal. Nothing is signed on this page. <a href={href.about()}>How it works</a> · Setup guide:{' '}
        <code>docs/CLI.md</code> in the repository.
      </p>
    </section>
  );
}

function Segmented<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="seg">
      <legend className="kicker">{legend}</legend>
      <div className="seg-options">
        {options.map((o) => (
          <label key={o.value} className={`seg-option seg-${o.value}`}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => {
                onChange(o.value);
              }}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
