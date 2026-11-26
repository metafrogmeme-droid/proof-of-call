import { callStatus, describeFeed, directionName, type CallRecord, type NetworkInfo } from '@proof-of-call/core';
import { PublisherLink, StatusBadge } from '../components/common';
import { relative, utc } from '../format';
import { callHref } from './links';

/**
 * Calls as a ledger of rows: call, status, publisher (or horizon), sealed time, asset and direction once revealed.
 * A list rather than a table, so it can fold into two-line rows on a phone.
 */
export function CallLedger({
  network,
  calls,
  now,
  column,
}: {
  network: NetworkInfo;
  calls: CallRecord[];
  now: bigint;
  column: 'publisher' | 'horizon';
}) {
  return (
    <div className={`ledger ledger-${column}`}>
      <div className="ledger-head" aria-hidden="true">
        <span>Call</span>
        <span>Status</span>
        <span>{column === 'publisher' ? 'Publisher' : 'Horizon'}</span>
        <span>Sealed</span>
        <span>Asset / direction</span>
      </div>
      <ol className="ledger-rows">
        {calls.map((c) => (
          <li key={c.key} className="ledger-row">
            <a className="lr-call" href={callHref(network, c)}>
              {c.label ?? c.callId.slice(0, 10)}
            </a>
            <span className="lr-status">
              <StatusBadge status={callStatus(c, now)} />
            </span>
            <span className="lr-who">
              {column === 'publisher' ? (
                <PublisherLink network={network} publisher={c.publisher} />
              ) : (
                `${(Number(c.sealed.horizon) / 3600).toString()} h`
              )}
            </span>
            <span className="lr-time" title={utc(c.sealed.sealedAt)}>
              {relative(c.sealed.sealedAt, now)}
            </span>
            <span className="lr-asset">
              {c.revealed ? (
                `${describeFeed(network, c.revealed.feed).asset ?? '?'} ${directionName(c.revealed.direction)}`
              ) : (
                <span className="muted">hidden until revealed</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
