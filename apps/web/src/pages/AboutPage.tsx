import { Card } from '../components/common';

export function AboutPage() {
  return (
    <>
      <Card title="How Proof of Call works">
        <ol className="steps">
          <li>
            <strong>Seal.</strong> Before the outcome is known, the publisher stores only a hash on QIE:
            <code className="wrap"> keccak256(chainId, contract, publisher, callId, feed, direction, salt)</code>. The
            asset and the direction stay hidden; a random 32-byte salt keeps them from being guessed.
          </li>
          <li>
            <strong>Wait.</strong> The call has a horizon (4 or 12 hours). Its scoring rules (maximum oracle gap, flat
            band) are fixed at seal time; nobody can change them afterwards.
          </li>
          <li>
            <strong>Reveal.</strong> After the horizon, anyone holding the opening reveals it. The contract checks it
            against the hash and proves on chain which oracle rounds count: the first price after the seal and the first
            price after the horizon. Nobody can pick a convenient price.
          </li>
          <li>
            <strong>Score.</strong> The contract scores the call HIT, MISS or FLAT against the QIE Oracle price. If the
            feed stalled or gave bad data, the call is VOID instead of guessed.
          </li>
          <li>
            <strong>No hiding.</strong> A call that is not revealed by its deadline can be expired by anyone and counts
            as a MISS. Every publisher's scorecard is public and computed by the contract.
          </li>
        </ol>
      </Card>
      <Card title="What runs where">
        <ul className="where">
          <li>
            The contract (<code>ProofOfCall</code>) holds no funds, is not upgradeable and only reads the allowlisted
            QIE Oracle feeds. Its owner can manage the feed list and the defaults for new calls, and nothing about
            existing calls.
          </li>
          <li>
            This page is static: it reads calls, scorecards and proofs straight from the QIE chain in your browser. No
            backend, no accounts, no analytics.
          </li>
          <li>
            Transactions (reveal, expire) are signed by your own browser wallet. Any wallet can reveal or expire a call;
            the result is always credited to its publisher.
          </li>
          <li>
            Publishers seal calls from their own wallets with the open-source command line tool; their salts never leave
            their machines until a call is revealed. The Seal a Call card on the overview only builds that command;
            nothing is signed for a seal in the browser.
          </li>
        </ul>
      </Card>
    </>
  );
}
