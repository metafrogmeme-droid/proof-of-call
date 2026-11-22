# Read layer: chain data straight into the browser

The web app has no backend, no database and no server keys (owner decision D7). Everything it shows is read from the
QIE chain in the visitor's browser by `packages/core/src/read.ts`. The same code runs in Node, which is how the tests
and the CLI use it.

## Sources

| Data | Where it comes from |
|---|---|
| Calls (sealed, revealed, expired) | `Sealed`, `Revealed`, `Expired` events of the network's ProofOfCall, from its deploy block (in `deployments/`) to the head |
| Scorecard per publisher | Folded from the events, and cross-checked against the contract's own `scorecard(publisher)` view |
| Revealer of a call | `getTransaction(revealTx).from` (the `Revealed` event does not carry the sender) |
| Live status (waiting / revealable / expirable) | The call's times against the latest block's timestamp (chain time, not the visitor's clock) |
| Prices and rounds | The `Revealed` event (entry/exit round and price), plus `getRoundData` on the feed for the proof page |

## Fetching events

`fetchEvents` asks `eth_getLogs` for the three event types in chunks of up to 5000 blocks. Public RPCs limit ranges
and response sizes, so on any error the chunk is halved, down to 50 blocks, and grows back after successes. At the
minimum size it retries with backoff (250 ms, 500 ms, 1 s, 2 s) and then fails with the block range in the message.
Events come back decoded and sorted by block and log index. The fetch can be aborted, for example when the visitor
switches network.

## Per-viewer cache

`syncEvents` keeps a snapshot per chain and contract in a `SnapshotStore` (`localStorage` in the browser). Only
events at least `reorgDepth` blocks (default 15) behind the head are cached. Newer blocks are fetched again on every
load, so a chain reorganisation can never be frozen into the cache. A snapshot of another contract, a corrupt
snapshot and a full or blocked storage are ignored, because the cache is only a convenience. It never leaves the browser.

## Call index

`buildIndex` folds the events into one `CallRecord` per (publisher, callId). Anything that does not fit (a reveal
without a seal, a second seal, an event for a settled call) is collected in `anomalies` and shown, never silently
dropped. From the index:

- `callStatus(call, now)`: `WAITING`, `REVEALABLE`, `EXPIRABLE`, or the outcome (`HIT`, `MISS`, `FLAT`, `VOID`, `EXPIRED`);
- `scorecardOf`: the contract's semantics (expired calls count as misses and as expiries);
- `publisherStats`: scorecard, open calls, hit rate = hits / (hits + misses) (FLAT and VOID are not decided);
- `verifierWallets`: every wallet other than the call's publisher that revealed a call (through a shared reveal link)
  or expired one (owner definition, 22 Nov 2026);
- `describeFeed`: asset and pair for known feeds. Any other feed is flagged (on mainnet: not a QIE Oracle feed, threat model T12).

## Tests

- `packages/core/test/read.test.ts`, offline:
  - index, statuses, scorecard and verifiers from a recorded event fixture (`fixtures/local-anvil-events.json`, local anvil data, labelled as such);
  - chunking that covers the range exactly once, range-limit halving, retries and abort, against a fake RPC;
  - cache behaviour (incremental tail, reorg depth, foreign or corrupt snapshot, full storage).
- `packages/cli/test/lifecycle.anvil.test.ts`, last step: after a full HIT / MISS / FLAT / VOID / EXPIRED run on anvil,
  the read layer rebuilds every call and the exact on-chain scorecard from events alone (3-block chunks), and a second
  load serves everything but the tail from the cache. `UPDATE_FIXTURES=1` re-records the fixture.

## Browser access to the RPC (CORS)

The browser reads the public QIE RPC directly. If an RPC does not allow cross-origin requests from the app's
origin, the web app falls back to the connected wallet's provider (an EIP-1193 `request`), which is not subject to
CORS. Without a wallet the visitor then sees a clear message instead of empty data.
