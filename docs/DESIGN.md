# ProofOfCall: design (Q1, testnet)

Status: draft for review. Testnet only. Nothing is deployed.

## Origin of the code

**All code in this repository is new and was written for QIE Mainnet Hackathon 3.0.** RUNECLAW's earlier
HashKey Chain entry (the "HashKey Seal", which stores a hash, a publisher and a kind) was used as a **design
reference only**: we looked at its ideas (two-step ownership, refusing value, documented renounce semantics,
walking the runtime bytecode in tests). No file, function body or test was copied from it or from any other
RUNECLAW repository. The oracle scoring, the round proofs, expiry-as-miss and the open per-publisher scorecards
are new for QIE.

## What it does

An AI agent (the *publisher*) commits to a market call before the outcome is known. Later the call is opened
and scored **on chain** against a Chainlink-style `AggregatorV3` price feed (the QIE Oracle on mainnet,
`MockAggregatorV3` on testnet). Nobody, including the publisher or the contract owner, can edit, drop or
cherry-pick calls afterwards.

### 1. Seal

```
seal(callId, commitment, horizon, revealBy)          // publisher = msg.sender
commitment = keccak256(abi.encode(chainid, address(this), publisher, callId, feed, direction, salt))
```

- `feed` (the asset) and `direction` (`UP = 1`, `DOWN = 2`) stay hidden until reveal. `salt` is a 32-byte secret
  that stops anyone from brute-forcing the small set of (feed, direction) pairs.
- `callId` is unique per publisher, so publishers have separate namespaces and cannot squat each other's ids.
- Bounds: `5 min <= horizon <= 366 days`; `target + maxGap + 1 h <= revealBy <= target + maxGap + 30 days`,
  where `target = sealedAt + horizon`. The minimum window guarantees there is always time to reveal, including
  with a stall proof (below).
- The current defaults (`maxGap`, `flatBandBps`) are **snapshotted into the call**. Later owner changes never
  affect an existing call.

### 2. Reveal (anyone holding the opening)

```
reveal(publisher, callId, feed, direction, salt, entryRound, exitRound)
```

Allowed when `target <= now <= revealBy`. Checks, in order: call exists, not settled, timing, the opening hashes
to the commitment, the direction is valid, and the feed was **on the allowlist at seal time**.

**Round proofs.** The caller names two round ids; the contract proves them:

- `entryRound` must be the first round with `updatedAt >= sealedAt`. Proven by reading round `r`
  (`updatedAt >= sealedAt`) and round `r - 1` (`updatedAt < sealedAt`). Round 1 needs no predecessor.
- `exitRound` must be the first round with `updatedAt >= target`, proven the same way.

So the entry price is one that only existed after the seal (no look-back) and neither price can be chosen:
for a feed whose `updatedAt` never decreases with the round id, exactly one round satisfies each proof.

**Stall proof.** If the feed has not updated since a target time, the caller passes the **latest** round. The
contract accepts it only if `latestRoundData().roundId == r`, `updatedAt(r) < t`, and `now > t + maxGap`.
That proves the feed stayed silent for more than `maxGap`, and the call is `VOID`.

### 3. Score

| Condition | Outcome |
|---|---|
| Entry or exit proven by stall proof, or proven round more than `maxGap` after its target | `VOID` (`EntryStalled` / `ExitStalled`) |
| Proven round has `answer <= 0`, `answer > int128.max`, `answeredInRound < roundId`, or `updatedAt > now` | `VOID` (`EntryBadData` / `ExitBadData`) |
| `|exit - entry| * 10_000 <= entry * flatBandBps` | `FLAT` |
| Price moved in the called direction | `HIT` |
| Otherwise | `MISS` |

Entry problems take precedence over exit problems in `voidReason`. A void call never gets a guessed score:
it fails closed. Prices are capped at `int128.max`, so the scoring arithmetic cannot overflow.

Malformed proofs (a wrong or unreadable round, an id mismatch, a round that is not the first after its target,
a stall proof that is not the latest round or comes too early) **revert** with an exact message instead of
voiding. Otherwise a publisher could void a losing call by passing a bad round.

### 4. Expire

After `revealBy`, **anyone** may call `expire(publisher, callId)`. The call is closed as `Expired` and counted as
a **miss** (`misses` and `expiries` both go up). A publisher cannot hide bad calls by never revealing them,
and a commitment that can never be opened (e.g. wrong feed, invalid direction) also ends as a miss.

### 5. Scorecard

`scorecard(publisher)` returns `sealedCalls, hits, misses (incl. expired), flats, voids, expiries`.
Invariant: `sealedCalls = open + hits + misses + flats + voids`, and `expiries <= misses`.
Events (`Sealed`, `Revealed`, `Expired`) carry everything an indexer needs for per-call proof pages.

### 6. Owner role

The owner (planned mainnet owner: the project owner's own wallet; publishers always sign from their own wallets,
so no server holds a key) can only:

- `addFeeds` (at most 32 per call, contracts only, never re-adding a listed or retired feed);
- `retireFeed` (calls sealed before the retirement can still be revealed against it);
- `setDefaults(maxGap, flatBandBps)` within `[1 min, 7 days]` and `<= 1000 bps`, for **new** seals only;
- two-step `transferOwnership` / `acceptOwnership`, and `renounceOwnership` (freezes the allowlist and
  defaults for good; sealing, revealing and expiring keep working).

None of these can move value, and none can change the outcome of a call that is already sealed.

### 7. Hard properties

- No `payable` function, no `receive` or `fallback`: the contract refuses value and holds no funds.
- Not upgradeable; no proxy, no `delegatecall`, no `selfdestruct`, no `create`.
- The only external calls are `STATICCALL` reads of `getRoundData` / `latestRoundData` on allowlisted feeds.
  `test/Bytecode.t.sol` walks the runtime bytecode and fails if `CALL`, `CALLCODE`, `DELEGATECALL`, `CREATE`,
  `CREATE2`, `SELFDESTRUCT` or `PUSH0` appear.
- No unbounded loops (the only loop is the feed list, capped at 32).
- Compiled with solc 0.8.28 for `evm_version = paris`. QIE's docs do not state an EVM level; a read-only opcode
  probe on 1 Nov 2026 showed QIE testnet and mainnet run at Shanghai level (`PUSH0` works, Cancun opcodes do not),
  so `paris` is safe and `cancun` must never be used. Details in `docs/DEPLOY.md`.

## Testnet mock

QIE testnet has no oracle contracts (checked with `eth_getCode`), so `MockAggregatorV3` stands in: 8 decimals,
`pushRound` (monotonic time), `setRound` / `setLatestRound` / `setReverting` for edge cases, and every write
restricted to its deployer. It must never be allowlisted on mainnet.

## Known limitations

- Feeds are assumed to have `updatedAt` non-decreasing in round id. Chainlink-style phase-encoded round ids
  (`phaseId << 64 | n`) are not supported across a phase boundary: the predecessor read would fail, so such
  a call reverts on reveal and eventually expires. The QIE feeds use plain ids starting at 1.
- The scorecard counts calls; it does not weight them. A publisher who seals both `UP` and `DOWN` on the same
  asset gets one hit and one miss (or two flats), which the public record shows.
- `maxGap` is one value per call for both entry and exit. QIE feeds update irregularly (hours apart for some
  assets), so the mainnet default needs to be chosen per the observed update cadence.
