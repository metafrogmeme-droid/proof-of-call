# ProofOfCall: threat model v1 (Q1, testnet)

Scope: `src/ProofOfCall.sol`, `src/mocks/MockAggregatorV3.sol`. All code is new for the QIE hackathon; the
earlier HashKey Seal entry was a design reference only and no code from it is used.

## Assets and goals

1. **Integrity of each call**: once sealed, nobody can change its asset, direction, timing or outcome.
2. **Completeness of the record**: a publisher cannot drop or hide calls.
3. **Fair pricing**: entry and exit prices come from rounds nobody chose.
4. **No value at risk**: the contract never holds or moves funds.

## Actors

| Actor | Can | Cannot |
|---|---|---|
| Publisher | seal in its own namespace, reveal, expire | edit or delete a sealed call, choose rounds, seal in another namespace |
| Anyone | reveal (with the opening), expire after the deadline, read | open a call without the salt |
| Owner | manage the feed allowlist and defaults for new seals, transfer or renounce ownership | change a sealed call, its snapshot or its outcome; move value |
| Feed (oracle) | report prices | make the contract send value or run code in its context |
| Block producer | shift `block.timestamp` slightly, reorder transactions | forge oracle history |

## Threats and mitigations

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | **Front-running a seal**: an attacker copies a pending commitment into their own namespace | The commitment binds `publisher`; a copied commitment can never be opened by the copier and expires as a miss for them | `test_reveal_revert_openingForOtherPublisher` |
| T2 | **Front-running a reveal**: an attacker sees the opening in the mempool and reveals first | Harmless: the outcome is fully determined by the opening and the proven rounds, and is credited to the publisher | `test_reveal_hitUp` (third-party reveal) |
| T3 | **Cross-chain / cross-deployment replay** of commitments | `chainid` and `address(this)` are in the commitment | `test_computeCommitment_binds*` |
| T4 | **Salt leak or weak salt** reveals the call early | Salt is a 32-byte secret held by the publisher (Q5 CLI keeps it in a local encrypted store, never logged). Without a salt only 2 x (number of feeds) openings exist, so a weak salt is brute-forceable: the CLI must use 32 random bytes | n/a (off-chain, Q5) |
| T5 | **Cherry-picking**: reveal winners, hide losers | Anyone can `expire` an unrevealed call after `revealBy`; it counts as a miss | `ProofOfCallExpireTest`, fuzz timing |
| T6 | **Flipping a call** (reveal DOWN for a sealed UP) | Direction is in the commitment | `test_reveal_revert_wrongDirection`, fuzz binding |
| T7 | **Look-back or convenient pricing**: pass an older or later round | Round proofs require the first round at or after each target (`r` and `r - 1` read on chain) | `test_reveal_revert_entryRoundBeforeCommit`, `..._entryNotFirstAfterSeal`, `..._exitNotFirstAfterHorizon`, fuzz `onlyFirstRoundAccepted` |
| T8 | **Stalled feed** gives a stale price | Gap above `maxGap` -> `VOID`; a silent feed is proven by the stall proof -> `VOID`; never a guessed score | `test_reveal_void_*Stall*`, `..._GapTooLarge` |
| T9 | **Bad oracle data** (zero, negative, huge, carried-over, future timestamp) | `VOID` with a `*BadData` reason | `test_reveal_void_*` |
| T10 | **Publisher voids a losing call** by passing a bad round | Malformed proofs revert with an exact message; only a correct proof of a genuinely stalled or bad round voids | revert tests in `ProofOfCallRevealTest` and `ProofOfCallQuirkyFeedTest` |
| T11 | **Feed swap by the owner** (retire a feed or change defaults to hurt open calls) | Allowlist is checked at seal time; retirement only affects later seals; defaults are snapshotted per call | `test_reveal_feedRetiredAfterSealStillWorks`, `test_setDefaults_doesNotChangeSealedCalls` |
| T12 | **Owner adds a malicious feed** | It can only affect calls whose publisher chose it after it was listed. Feeds are reached only via `STATICCALL`, so they cannot change state or receive value. Publishers should only use the documented QIE Oracle addresses; the indexer (Q6) will flag non-QIE feeds | `test/Bytecode.t.sol` |
| T13 | **Malicious feed reverts or lies about ids** to grief reveals | Reverts and id mismatches revert the reveal (call then expires as a miss for the publisher who chose that feed). Publishers bear the risk of their own feed choice | `ProofOfCallQuirkyFeedTest` |
| T14 | **Griefing by expiry**: someone expires a call early | `expire` only works strictly after `revealBy`, which is at least `maxGap + 1 h` after the target | `test_expire_revert_windowOpen`, fuzz timing |
| T15 | **Publisher spam** (many calls, inflated `sealedCalls`) | Each seal costs gas and every one ends in a bucket; spam only fills the spammer's own scorecard. No global state is shared between publishers, and there are no global loops | invariant `countersAddUp` |
| T16 | **Double scoring** | Outcome is set once; `reveal` and `expire` both require `Open` | `test_reveal_revert_doubleReveal`, `test_expire_revert_double`, invariant `settledAtMostOnce` |
| T17 | **Overflow** in time or price arithmetic | Times are widened to `uint256` before adding; `horizon` and `revealBy` are range-checked; prices capped at `int128.max` | `test_seal_revert_*MaxUint`, `test_reveal_extremePrices*`, fuzz `score_matchesReference` |
| T18 | **Value stuck or stolen** | No payable functions, no `receive`/`fallback`, no `CALL` opcode in the runtime | `test_rejectsPlainValue`, `test_seal_revert_withValue`, `test/Bytecode.t.sol`, invariant `holdsNoValue` |
| T19 | **Timestamp manipulation** by block producers | A few seconds of drift can move a boundary by one round at most; horizons are at least 5 minutes and the round proof still uses real oracle rounds | n/a |
| T20 | **Ownership takeover** via a mistyped address | Two-step transfer; only the pending owner can accept; zero cancels | `test_twoStepOwnership`, `test_transferOwnership_cancel` |
| T21 | **Mock allowlisted on mainnet** (anyone could script prices) | Mock writes are deployer-only; `script/DeployConfig.sol` never deploys a mock on chain 1990 and only accepts the 7 official QIE Oracle feeds there; `Check.s.sol` fails on a non-QIE feed on mainnet; mainnet deploy is the owner's own action | `test_params_revert_mainnetMock`, `..._mainnetNonQieFeed`, `testFuzz_isQieMainnetFeed_onlyTheSeven`, `test_check_revert_mockOnMainnet` |

## Deploy tooling (Q2)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| D1 | **Wrong chain**: deploying to mainnet or another EVM by a wrong RPC or copy-paste | `eth_chainId` compared to `POC_EXPECTED_CHAIN_ID` in `deploy.sh` and again as `block.chainid` in the script; only 1983 allowed, 1990 behind `POC_MAINNET_GO=yes` + not CI + no env key | `test_chain_*`, `testFuzz_chain_revert_anyOtherChain`, `test_deploy_revert_*Chain*` |
| D2 | **Key leak** via files, logs, git or shell history | Keystore or Ledger preferred; env key testnet only, never in `.env` (`deploy.sh` refuses key-like variable names there); format check never prints the value; `.env`, `keystore/`, `*.key`, `broadcast/`, `cache/` gitignored; gitleaks in CI | `deploy.sh` guards, CI secret scan |
| D3 | **Wrong signer** (e.g. a personal wallet) | Signer must equal `POC_EXPECTED_DEPLOYER`; forge's default sender refused | `test_deploy_revert_wrongDeployer`, `test_deploy_revert_noSigner` |
| D4 | **Silent build drift** (`FOUNDRY_EVM_VERSION=cancun`, optimizer changes) | `deploy.sh` refuses `FOUNDRY_*`/`DAPP_*` in env and `.env`; `test/Bytecode.t.sol` rejects `PUSH0` | `deploy.sh`, `test/Bytecode.t.sol` |
| D5 | **Misconfigured contract** (wrong owner, maxGap, band, feeds) goes unnoticed | Bounds checked before any transaction; read-back in the same run; `Check.s.sol` re-reads live state | `test_params_*`, `CheckScriptTest` |
| D6 | **Accidental broadcast** | Simulation always first; broadcast needs `--broadcast` and typing the chain id | `deploy.sh` |
| D7 | **Owner = deployer hot key** | `POC_OWNER` is separate from the deployer; the deployer keeps only the mock admin role (testnet) | `test_deploy_testnet_deploysAndReadsBack` |

## Out of scope for Q1 / open items

- Publisher CLI and salt storage (Q5), indexer (Q6),
  web app (Q7), external audit and static analysis (Q10).
- Phase-encoded round ids across a phase boundary (see DESIGN known limitations).
- QIE's EVM level is undocumented; the Q2 probe found Shanghai level on testnet and mainnet (see `docs/DEPLOY.md`). We keep `paris`.
- Explorer source verification (commands in `docs/DEPLOY.md`) and the mainnet runbook (Q11).
