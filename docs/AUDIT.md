# Self-review (QIE Hackathon 3.0)

**This is the team's own review, not an external audit.** The code has not been audited by a third party. Treat the
contract as hackathon software: it holds no funds by design, but its outputs (track records) are what people will rely on.

Reviewed: 22–25 Nov 2026, on the branches of PRs #4–#9 (combined in the docs-pack branch).

## Scope

| Area | Files |
|---|---|
| Contract | `src/ProofOfCall.sol`, `src/interfaces/IAggregatorV3.sol`, `src/mocks/MockAggregatorV3.sol` (testnet only) |
| Deploy tooling | `script/*.sol`, `script/deploy.sh`, `script/deploy-mainnet.ps1`, `script/MainnetDeploy.psm1` |
| Publisher CLI | `packages/cli/src` (vault, signers, commands) |
| Shared library and read layer | `packages/core/src` |
| Web app | `apps/web/src`, `apps/web/vite.config.ts`, `apps/web/vercel.json` |

## Method

- Line-by-line manual review of every file in scope, against `docs/THREAT_MODEL.md` (contract T1–T21, deploy D1–D13,
  CLI C1–C7, read layer R1–R4, web W1–W7). Every mitigation there is tied to a test.
- **Contract tests**: 207 Foundry tests in the CI profile.
  - unit tests with exact revert strings;
  - fuzzing (2000 runs) of timing, commitment binding, the first-round-only proofs and scoring against a reference;
  - invariants (256 × 100): counters add up, settled at most once, holds no value;
  - a runtime bytecode walk (no `CALL`/`DELEGATECALL`/`CREATE`/`SELFDESTRUCT`/`PUSH0`);
  - deploy-script tests, incl. an offline mainnet deployment against feed code etched at the official addresses.
- **Off-chain tests**: 98 Vitest tests.
  - commitment vectors cross-checked with `cast`, and against the contract on anvil;
  - vault cryptography and tampering, local signing page security;
  - a full HIT / MISS / FLAT / VOID / EXPIRED lifecycle on anvil, after which the read layer rebuilds the exact on-chain scorecard;
  - Chromium end-to-end tests of the signing page and of the built web app.
- **Static checks in CI**: `forge fmt`, TypeScript strict, ESLint `strict-type-checked` + react-hooks, Prettier,
  shellcheck, PSScriptAnalyzer, gitleaks (full history), an ABI drift check, and a production-bundle audit (CSP,
  external hosts).
- Not done: an external audit, Slither/Mythril, and formal verification. No static analysers beyond the compiler and
  linters were available in the build environment. Running Slither before any value-bearing use is recommended (see below).

## Contract review checklist

| Topic | Result |
|---|---|
| Value handling | No `payable`, no `receive`/`fallback`; any value transfer reverts. No funds can be stuck or stolen (T18) |
| External calls / reentrancy | Only `STATICCALL` to allowlisted feeds (bytecode walk). Feeds cannot change state or re-enter |
| Access control | Owner: feed allowlist, defaults for new seals, two-step ownership, renounce. No owner path touches an existing call (T11, T20) |
| Commitment binding | Chain id, contract, publisher, call id, feed, direction, salt. Prevents cross-chain/contract replay and copying into another namespace (T1, T3, T6) |
| Price selection | Entry and exit are proven to be the first rounds at or after their targets (reads `r` and `r - 1`); no look-back (T7) |
| Oracle failures | Stalls and bad data give VOID, never a guess; malformed proofs revert so a publisher cannot void a losing call (T8–T10) |
| Completeness | Unrevealed calls can be expired by anyone after the deadline and count as misses (T5) |
| Arithmetic | Solidity 0.8 checks; times widened before addition; prices capped at `int128.max` (T17) |
| DoS | No unbounded loops (feed list ≤ 32 per call); no shared state between publishers (T15) |
| Upgradeability | None: no proxy, no `delegatecall`, no `selfdestruct` |
| Compiler / EVM | solc 0.8.28, `paris`; QIE probed at Shanghai level; deploy refuses PUSH0/Cancun bytecode (D4, D8) |

## Findings

Severity: High = wrong scores or lost calls for users; Medium = wrong data shown; Low = hardening; Info = note.

| ID | Area | Severity | Finding | Status |
|---|---|---|---|---|
| F1 | Read layer | Medium | `syncEvents` read the chain head through viem's few-second block-number cache. A client that had just polled for a receipt saw a stale head and missed the newest events (intermittent scorecard mismatch under load; a refresh right after a reveal could have missed it) | **Fixed** (#7): `getBlockNumber({ cacheTime: 0 })`, lifecycle test compares full scorecards |
| F2 | CLI, web | Low | viem follows EIP-3668 `OffchainLookup` reverts by default, so a malicious contract read during reveal could make the CLI (no CSP) fetch an arbitrary URL | **Fixed** (#6, #8): `ccipRead: false` everywhere; the web CSP would block it as well |
| F3 | Web | Low | Full addresses overflowed the page at phone width | **Fixed** (#8); end-to-end test asserts no horizontal scroll at 390 px |
| F4 | Mainnet tooling | Info | The `*PASSWORD*` environment rule refused unrelated variables (`PGPASSWORD` on the Windows runner) | **Fixed** (#5): refuses key/mnemonic names and Foundry's `ETH_PASSWORD`/`CAST_PASSWORD` |
| F5 | CLI | Info | `seal` asked for the vault password before validating its other arguments | **Fixed** (#6); subprocess test |
| F6 | Tests | Info | Test anvils on random ports could in theory share a port and a chain | **Fixed** (#7): anvil on OS-chosen ports |
| F7 | Mainnet | **High (process)** | The BTC / USDT and ETH / USDT QIE Oracle addresses come from the QIE docs and were checked when Q1 was written, but this review's environment could not reach `docs.qie.digital` or the QIE RPCs to re-verify them. The repo also labelled them "/ USD", while on chain they are "/ USDT" | **Closed** (22 Nov 2026): the owner verified both read-only against the QIE docs and chain 1990 (block 12088889, `rpc1mainnet`): code present, 8 decimals, descriptions `BTC / USDT` / `ETH / USDT`, recent rounds. Evidence in `deployments/qie-mainnet-1990.config.json`; labels corrected. The RPC's CORS behaviour stays open as F12 |
| F8 | Contract | Info | Chainlink-style phase-encoded round ids are not supported across a phase boundary (such a reveal reverts and the call expires) | Accepted (documented). QIE feeds use plain ids; `FeedCadence.s.sol` checks this before deploy |
| F9 | Contract | Info | One `maxGap` per call for entry and exit; QIE feeds update irregularly | Accepted. Chosen per measured cadence (`FeedCadence.s.sol`, `docs/MAINNET.md` step 5) |
| F10 | Contract | Info | Scorecards count calls, unweighted. A publisher can seal UP and DOWN on the same asset | Accepted (design). Both calls are public and scored, so the record shows the hedge |
| F11 | CLI | Low (operational) | Losing the vault means sealed calls can never be revealed and expire as misses | Mitigated: vault written before sending, atomic replace with `.bak`, backup instructions (`docs/CLI.md`) |
| F12 | Web | Info | If the public QIE RPC refuses browser requests (CORS), visitors without a wallet see an error message instead of data | Mitigated: wallet-provider fallback; to be confirmed against the live RPC (F7) |
| F13 | Testnet | Info | Testnet prices come from our mock feed and are pushed by the deployer key | By design (QIE testnet has no oracle); labelled "test mock" in the app; mainnet uses QIE Oracle feeds only, enforced by the deploy guards |

No High or Medium finding is open. F7, the process blocker for the mainnet deployment, was closed on 22 Nov 2026 by the owner's read-only verification; `maxGap` is still chosen with the cadence check right before the deploy (`docs/MAINNET.md` step 5).

## Residual risks and recommendations

1. **Oracle trust.** Scores are only as good as the QIE Oracle feeds. Stalls and bad data are handled (VOID), but a
   feed that reports wrong prices on time would produce wrong scores. Monitor feed health, and retire a feed (owner)
   if needed: only future seals are affected.
2. **Owner key.** The owner can add feeds. A malicious feed only affects calls whose publisher chose it, and the web app
   flags non-QIE feeds. The owner key should still be a hardware wallet or be renounced once the feed list is final.
3. **Before any value-bearing use** (paid signals, staking on track records): an external audit, Slither and
   Mythril runs, and a review of the off-chain signing flow on real wallets.
4. **Salt custody.** Publishers must back up their vault. A future version could derive salts from a wallet signature
   so they can be recovered.
