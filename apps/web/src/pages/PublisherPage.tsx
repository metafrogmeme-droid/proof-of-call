import {
  callsOf,
  callStatus,
  describeFeed,
  directionName,
  publisherStats,
  readScorecard,
  sameScorecard,
  scorecardOf,
  verifierWallets,
  type NetworkInfo,
  type Scorecard,
} from '@proof-of-call/core';
import type { Address } from 'viem';
import { useEffect, useState } from 'react';
import { AddressLink, Card, ErrorBox, Loading, StatusBadge } from '../components/common';
import type { NetworkData } from '../data';
import { percent, relative, sameAddress, utc } from '../format';
import { callHref } from './links';

export function PublisherPage({
  network,
  data,
  publisher,
}: {
  network: NetworkInfo;
  data: NetworkData;
  publisher: Address;
}) {
  const [onchain, setOnchain] = useState<Scorecard | null>(null);
  const contract = network.proofOfCall?.address;
  const client = data.client;
  useEffect(() => {
    if (!client || !contract) return;
    let live = true;
    readScorecard(client, contract, publisher).then(
      (card) => {
        if (live) setOnchain(card);
      },
      () => {
        if (live) setOnchain(null);
      },
    );
    return () => {
      live = false;
    };
  }, [client, contract, publisher, data.head]);

  if (!data.index || data.now === null)
    return data.error ? <ErrorBox text={data.error} /> : <Loading text="Reading calls from the chain…" />;
  const index = data.index;
  const now = data.now;
  const card = scorecardOf(index, publisher);
  const stats = publisherStats(index).find((s) => sameAddress(s.publisher, publisher));
  const calls = callsOf(index, publisher);
  const verifiers = verifierWallets({ calls: new Map(calls.map((c) => [c.key, c])), anomalies: [] });

  return (
    <>
      <Card title="Publisher scorecard">
        <p>
          <AddressLink network={network} address={publisher} label={publisher} />
        </p>
        <div className="scorecard">
          <Score label="Sealed" value={card.sealedCalls} />
          <Score label="Hit" value={card.hits} />
          <Score
            label="Miss"
            value={card.misses}
            note={card.expiries > 0n ? `${card.expiries.toString()} expired` : undefined}
          />
          <Score label="Flat" value={card.flats} />
          <Score label="Void" value={card.voids} />
          <Score label="Open" value={BigInt(stats?.open ?? 0)} />
        </div>
        <p>
          Hit rate <strong>{percent(stats?.hitRate ?? null)}</strong>{' '}
          <span className="muted">
            (hits / (hits + misses); flat and void calls are not decided; an expired call is a miss)
          </span>
        </p>
        {onchain ? (
          sameScorecard(onchain, card) ? (
            <p className="ok">✓ Matches the contract's own scorecard() for this address.</p>
          ) : (
            <p className="error">
              The events read so far do not match the contract's scorecard(); the page may still be loading new blocks.
            </p>
          )
        ) : null}
      </Card>

      <Card title={`Calls (${calls.length})`}>
        {calls.length === 0 ? (
          <p className="muted">No calls from this address on {network.name}.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Status</th>
                  <th>Horizon</th>
                  <th>Sealed</th>
                  <th>Asset / direction</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <a href={callHref(network, c)}>{c.label ?? c.callId.slice(0, 10)}</a>
                    </td>
                    <td>
                      <StatusBadge status={callStatus(c, now)} />
                    </td>
                    <td>{(Number(c.sealed.horizon) / 3600).toString()} h</td>
                    <td title={utc(c.sealed.sealedAt)}>{relative(c.sealed.sealedAt, now)}</td>
                    <td>
                      {c.revealed ? (
                        `${describeFeed(network, c.revealed.feed).asset ?? '?'} ${directionName(c.revealed.direction)}`
                      ) : (
                        <span className="muted">hidden until revealed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {verifiers.length > 0 ? (
        <Card title={`Verifier wallets (${verifiers.length})`}>
          <p className="muted">
            Wallets other than the publisher that revealed one of these calls (from a shared link) or expired one.
          </p>
          <ul className="plain">
            {verifiers.map((v) => (
              <li key={v.address}>
                <AddressLink network={network} address={v.address} /> {v.reveals} reveal{v.reveals === 1 ? '' : 's'},{' '}
                {v.expiries} expir{v.expiries === 1 ? 'y' : 'ies'}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Score({ label, value, note }: { label: string; value: bigint; note?: string | undefined }) {
  return (
    <div className="score">
      <span className="score-value">{value.toString()}</span>
      <span className="score-label">{label}</span>
      {note ? <span className="score-note">{note}</span> : null}
    </div>
  );
}
