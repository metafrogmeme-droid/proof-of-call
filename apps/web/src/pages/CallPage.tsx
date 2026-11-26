import {
  callKey,
  callStatus,
  computeCommitment,
  contractFeedReader,
  describeFeed,
  directionName,
  findProofRound,
  outcomeName,
  parseOpeningJson,
  proofOfCallAbi,
  targetOf,
  voidReasonName,
  type CallRecord,
  type CallRoute,
  type NetworkInfo,
  type Opening,
} from '@proof-of-call/core';
import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AddressLink,
  Card,
  ErrorBox,
  Hash,
  Loading,
  PublisherLink,
  StatusBadge,
  Terminal,
  TxLink,
} from '../components/common';
import type { NetworkData } from '../data';
import { movePercent, price, relative, sameAddress, shortAddress, utc } from '../format';
import { verifyRevealed, type Check } from '../verify';
import type { WalletState } from '../wallet';

export function CallPage({
  network,
  data,
  route,
  wallet,
}: {
  network: NetworkInfo;
  data: NetworkData;
  route: CallRoute;
  wallet: WalletState;
}) {
  if (!data.index || data.now === null || !data.client)
    return data.error ? <ErrorBox text={data.error} /> : <Loading text="Reading the call from the chain…" />;
  const call = data.index.calls.get(callKey(route.publisher, route.callId));
  if (!call) {
    return (
      <Card title="Call not found">
        <p>
          No call <code>{route.callId}</code> by <code>{route.publisher}</code> on {network.name} (read up to block{' '}
          {data.head?.toString()}).
        </p>
      </Card>
    );
  }
  const status = callStatus(call, data.now);
  const target = targetOf(call);
  const closed = !!call.revealed || !!call.expired || data.now > call.sealed.revealBy;
  return (
    <>
      <Card
        title={
          <>
            Call {call.label ?? <code title={call.callId}>{shortAddress(call.callId)}</code>}{' '}
            <StatusBadge status={status} />
          </>
        }
      >
        <dl className="facts">
          <dt>Publisher</dt>
          <dd>
            <PublisherLink network={network} publisher={call.publisher} />
          </dd>
          <dt>Call id</dt>
          <dd>
            <Hash value={call.callId} label="Copy call id" />
          </dd>
          <dt>Commitment</dt>
          <dd>
            <Hash value={call.sealed.commitment} label="Copy commitment" />
          </dd>
          <dt>Scoring</dt>
          <dd>
            max gap {call.sealed.maxGap / 3600} h, flat band {call.sealed.flatBandBps / 100} % (fixed at seal time)
          </dd>
        </dl>
        <ol className="timeline">
          <li className="done">
            <span className="tl-label">Sealed</span>
            <span className="tl-time">{utc(call.sealed.sealedAt)}</span>
            <span className="tl-meta">
              {relative(call.sealed.sealedAt, data.now)} · block {call.sealed.block.toString()} · tx{' '}
              <TxLink network={network} hash={call.sealed.tx} />
            </span>
          </li>
          <li className={data.now >= target ? 'done' : undefined}>
            <span className="tl-label">Target</span>
            <span className="tl-time">{utc(target)}</span>
            <span className="tl-meta">
              {relative(target, data.now)} · {(Number(call.sealed.horizon) / 3600).toString()} h horizon
            </span>
          </li>
          <li className={closed ? 'done' : undefined}>
            <span className="tl-label">Reveal by</span>
            <span className="tl-time">{utc(call.sealed.revealBy)}</span>
            <span className="tl-meta">{relative(call.sealed.revealBy, data.now)}</span>
          </li>
        </ol>
        {!call.revealed && !call.expired ? (
          <p className="muted hidden-note">
            The asset and the direction of this call are hidden: only the commitment above is on chain until it is
            revealed.
          </p>
        ) : null}
      </Card>

      {call.revealed ? <RevealedCard network={network} call={call} client={data.client} /> : null}
      {call.expired ? (
        <Card title="Expired">
          <p>
            Not revealed by its deadline. Closed by <AddressLink network={network} address={call.expired.caller} /> in
            tx <TxLink network={network} hash={call.expired.tx} />. It counts as a miss for the publisher.
          </p>
        </Card>
      ) : null}

      {status === 'REVEALABLE' ? (
        <RevealPanel network={network} call={call} route={route} data={data} wallet={wallet} />
      ) : null}
      {status === 'EXPIRABLE' ? <ExpirePanel network={network} call={call} data={data} wallet={wallet} /> : null}
      {status === 'WAITING' ? (
        <Card title="Next">
          <p>
            It can be revealed from {utc(targetOf(call))}. If nobody reveals it by {utc(call.sealed.revealBy)}, anyone
            can expire it and it counts as a miss.
          </p>
        </Card>
      ) : null}
    </>
  );
}

function RevealedCard({ network, call, client }: { network: NetworkInfo; call: CallRecord; client: PublicClient }) {
  const r = call.revealed;
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    verifyRevealed(client, network, call).then(
      (c) => {
        if (live) setChecks(c);
      },
      (err: unknown) => {
        if (live) setCheckError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [client, network, call]);
  if (!r) return null;
  const feed = describeFeed(network, r.feed);
  const outcome = outcomeName(r.outcome);
  const tone = outcome.toLowerCase();
  const cast = [
    `cast call ${network.proofOfCall?.address ?? '<contract>'} \\`,
    `  "getCall(address,bytes32)" \\`,
    `  ${call.publisher} \\`,
    `  ${call.callId} \\`,
    `  --rpc-url ${network.rpcUrls[0] ?? '<rpc url>'}`,
  ].join('\n');
  return (
    <Card title="Revealed">
      <dl className="facts facts-hero">
        <div className="tile">
          <dt>Call</dt>
          <dd>
            <strong>
              {feed.asset ?? feed.pair} {directionName(r.direction)}
            </strong>
            {feed.known ? null : <span className="error">feed not known for {network.name}</span>}
          </dd>
        </div>
        <div className={`tile tile-${tone}`}>
          <dt>Outcome</dt>
          <dd>
            <strong className={`outcome outcome-${tone}`}>{outcome}</strong>
            {outcome === 'VOID' ? (
              <span className="tile-note">
                {voidReasonName(r.voidReason)}: the feed stalled or gave bad data, so no price was guessed
              </span>
            ) : null}
          </dd>
        </div>
        {outcome !== 'VOID' ? (
          <div className="tile">
            <dt>Move</dt>
            <dd>
              <span className="price">{movePercent(r.entryPrice, r.exitPrice)}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      <dl className="facts">
        {outcome !== 'VOID' ? (
          <>
            <dt>Entry</dt>
            <dd>
              <span className="price">{price(r.entryPrice)}</span>{' '}
              <span className="muted">round {r.entryRound.toString()}</span>
            </dd>
            <dt>Exit</dt>
            <dd>
              <span className="price">{price(r.exitPrice)}</span>{' '}
              <span className="muted">round {r.exitRound.toString()}</span>
            </dd>
          </>
        ) : null}
        <dt>Feed</dt>
        <dd>
          {feed.pair} <AddressLink network={network} address={r.feed} copy="Copy feed address" />
        </dd>
        <dt>Revealed by</dt>
        <dd>
          {r.revealer ? <AddressLink network={network} address={r.revealer} /> : 'unknown'}
          {r.revealer && !sameAddress(r.revealer, call.publisher) ? (
            <span className="badge badge-verifier">verifier</span>
          ) : null}{' '}
          in tx <TxLink network={network} hash={r.tx} />
        </dd>
      </dl>
      <h3>Verify it yourself</h3>
      {checkError ? <ErrorBox text={checkError} /> : null}
      {checks ? (
        <>
          <CheckSummary checks={checks} />
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.label} className={c.ok === true ? 'ok' : c.ok === false ? 'error' : 'muted'}>
                <span className="check-icon" aria-hidden="true">
                  {c.ok === true ? '✓' : c.ok === false ? '✗' : '•'}
                </span>
                <strong className="check-label">
                  {c.label}
                  <span className="sr-only">{c.ok === true ? ': passed' : c.ok === false ? ': failed' : ': note'}</span>
                </strong>
                <span className="check-detail">{withHashes(c.detail)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : checkError ? null : (
        <Loading text="Re-checking the commitment and the oracle rounds in your browser…" />
      )}
      <Terminal title="Or with Foundry" command={cast} copyLabel="Copy cast command" />
    </Card>
  );
}

function CheckSummary({ checks }: { checks: Check[] }) {
  const n = checks.length;
  if (n === 0) return null;
  const passed = checks.filter((c) => c.ok === true).length;
  const failed = checks.filter((c) => c.ok === false).length;
  if (failed > 0)
    return (
      <p className="check-summary error">
        {failed} of {n} checks failed.
      </p>
    );
  if (passed === n) return <p className="check-summary ok">All {n} checks passed, recomputed in your browser.</p>;
  return (
    <p className="check-summary muted">
      {passed} of {n} checks passed; read the {n - passed === 1 ? 'note' : 'notes'} below.
    </p>
  );
}

const LONG_HEX = /(0x[0-9a-fA-F]{40,})/;

/** Shows the full hashes in a check's detail truncated, with a copy button each. */
function withHashes(detail: string): ReactNode[] {
  return detail
    .split(LONG_HEX)
    .map((part, i) => (i % 2 === 1 ? <Hash key={`${i.toString()}-${part}`} value={part} label="Copy hash" /> : part));
}

function openingFromRoute(network: NetworkInfo, route: CallRoute): Opening | null {
  if (!route.opening || !network.proofOfCall) return null;
  return {
    chainId: network.chainId,
    contract: network.proofOfCall.address,
    publisher: route.publisher,
    callId: route.callId,
    ...route.opening,
  };
}

function WalletGate({ network, wallet, children }: { network: NetworkInfo; wallet: WalletState; children: ReactNode }) {
  if (!wallet.account)
    return (
      <p className="muted">
        Connect a wallet (top right) to send the transaction. Any wallet can do it; you pay the gas.
      </p>
    );
  if (wallet.chainId !== network.chainId) {
    return (
      <button type="button" onClick={() => void wallet.switchTo(network)}>
        Switch the wallet to {network.name}
      </button>
    );
  }
  return <>{children}</>;
}

function useSend(data: NetworkData, wallet: WalletState) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (prepare: () => Promise<{ to: Address; data: Hex; preview: string }>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const tx = await prepare();
      setMessage(`${tx.preview} Confirm in your wallet…`);
      const hash = await wallet.send(tx);
      setMessage(`Sent ${hash}. Waiting for the block…`);
      const receipt = await data.client?.waitForTransactionReceipt({ hash });
      if (receipt?.status !== 'success') throw new Error(`transaction ${hash} failed`);
      setMessage('Done. The page now shows the result.');
      data.refresh();
    } catch (err) {
      setError(err instanceof Error ? (err.message.split('\n')[0] ?? String(err)) : String(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, error, run };
}

function RevealPanel({
  network,
  call,
  route,
  data,
  wallet,
}: {
  network: NetworkInfo;
  call: CallRecord;
  route: CallRoute;
  data: NetworkData;
  wallet: WalletState;
}) {
  const [opening, setOpening] = useState<Opening | null>(() => openingFromRoute(network, route));
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const { busy, message, error, run } = useSend(data, wallet);
  const matches = opening
    ? computeCommitment(opening) === call.sealed.commitment &&
      sameAddress(opening.publisher, call.publisher) &&
      opening.callId === call.callId
    : false;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    setFileName(file.name);
    file.text().then(
      (text) => {
        try {
          setOpening(parseOpeningJson(text));
        } catch (err) {
          setFileError(err instanceof Error ? err.message : String(err));
        }
      },
      () => {
        setFileError('could not read the file');
      },
    );
  };

  const reveal = () =>
    run(async () => {
      const client = data.client;
      const contract = network.proofOfCall?.address;
      if (!opening || !client || !contract || !wallet.account) throw new Error('not ready');
      const now = (await client.getBlock({ blockTag: 'latest' })).timestamp;
      const reader = contractFeedReader(client, opening.feed);
      const maxGap = BigInt(call.sealed.maxGap);
      const entry = await findProofRound(reader, call.sealed.sealedAt, maxGap, now);
      const exit = await findProofRound(reader, targetOf(call), maxGap, now);
      if (entry.kind === 'wait' || exit.kind === 'wait') {
        const until = entry.kind === 'wait' ? entry.until : exit.kind === 'wait' ? exit.until : now;
        throw new Error(
          `The feed has no price round after the target yet. Try again later (at the latest after ${utc(until)}).`,
        );
      }
      const args = [
        opening.publisher,
        opening.callId,
        opening.feed,
        opening.direction,
        opening.salt,
        entry.roundId,
        exit.roundId,
      ] as const;
      const { result } = await client.simulateContract({
        address: contract,
        abi: proofOfCallAbi,
        functionName: 'reveal',
        args,
        account: wallet.account,
      });
      return {
        to: contract,
        data: encodeFunctionData({ abi: proofOfCallAbi, functionName: 'reveal', args }),
        preview: `Expected outcome: ${outcomeName(result)}.`,
      };
    });

  return (
    <Card title="Reveal this call" className="action">
      <p className="callout callout-warn">
        <strong>Revealing makes this call public for good:</strong> its asset, direction and prices. The outcome is
        fixed by the oracle and credited to the publisher, whoever sends the transaction.
      </p>
      {opening ? (
        matches ? (
          <p className="ok status-line">
            ✓ The opening matches the sealed commitment: {describeFeed(network, opening.feed).asset ?? opening.feed}{' '}
            {directionName(opening.direction)}.
          </p>
        ) : (
          <p className="error status-line">This opening does not match the sealed commitment of this call.</p>
        )
      ) : (
        <p className="muted">
          This needs the call's opening: open the publisher's reveal link, or load the opening file.
        </p>
      )}
      <label className="file">
        <input type="file" className="sr-only" accept="application/json,.json" onChange={onFile} />
        <span className="file-kicker kicker">Opening file (.json)</span>
        <span className="file-button">Choose opening file</span>
        <span className="file-name">{fileName ?? 'none loaded (from poc export)'}</span>
      </label>
      {fileError ? <ErrorBox text={fileError} /> : null}
      {matches ? (
        <div className="action-row">
          <WalletGate network={network} wallet={wallet}>
            <button type="button" disabled={busy} onClick={() => void reveal()}>
              {busy ? 'Revealing…' : 'Reveal (public)'}
            </button>
          </WalletGate>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <ErrorBox text={error} /> : null}
    </Card>
  );
}

function ExpirePanel({
  network,
  call,
  data,
  wallet,
}: {
  network: NetworkInfo;
  call: CallRecord;
  data: NetworkData;
  wallet: WalletState;
}) {
  const { busy, message, error, run } = useSend(data, wallet);
  const expire = () =>
    run(async () => {
      const client = data.client;
      const contract = network.proofOfCall?.address;
      if (!client || !contract || !wallet.account) throw new Error('not ready');
      const args = [call.publisher, call.callId] as const;
      await client.simulateContract({
        address: contract,
        abi: proofOfCallAbi,
        functionName: 'expire',
        args,
        account: wallet.account,
      });
      return {
        to: contract,
        data: encodeFunctionData({ abi: proofOfCallAbi, functionName: 'expire', args }),
        preview: 'The call will be closed as a miss.',
      };
    });
  return (
    <Card title="Expire this call" className="action action-expire">
      <p>
        This call was not revealed by {utc(call.sealed.revealBy)}. Anyone can close it now; it counts as a{' '}
        <strong>miss</strong> for the publisher, so unrevealed calls cannot be hidden.
      </p>
      <div className="action-row">
        <WalletGate network={network} wallet={wallet}>
          <button type="button" className="danger" disabled={busy} onClick={() => void expire()}>
            {busy ? 'Expiring…' : 'Expire (counts as a miss)'}
          </button>
        </WalletGate>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {error ? <ErrorBox text={error} /> : null}
    </Card>
  );
}
