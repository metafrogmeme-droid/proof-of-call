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
| T4 | **Salt leak or weak salt** reveals the call early | Salt is 32 bytes from the platform CSPRNG (`randomSalt`), kept only in the publisher's encrypted vault and never logged; `share`/`export` refuse before the horizon. Without a salt only 2 x (number of feeds) openings exist, so a weak salt would be brute-forceable | `randomSalt` test, vault tests, lifecycle `refuses to reveal, share or export before the horizon` |
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
| T21 | **Mock allowlisted on mainnet** (anyone could script prices) | Mock writes are deployer-only; `script/DeployConfig.sol` never deploys a mock on chain 1990 and only accepts the 7 official QIE Oracle feeds there; `Check.s.sol` fails on a non-QIE feed on mainnet; mainnet deploy is the owner's own action (`docs/MAINNET.md`) | `test_params_revert_mainnetMock`, `..._mainnetNonQieFeed`, `testFuzz_isQieMainnetFeed_onlyTheSeven`, `test_check_revert_mockOnMainnet` |

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

## Mainnet deploy tooling (Q4)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| D8 | **Guards bypassed by running forge by hand** (e.g. from PowerShell without `deploy.sh`) with `FOUNDRY_EVM_VERSION=cancun` or similar | `Deploy.s.sol` itself refuses build-changing `FOUNDRY_*`/`DAPP_*` variables and walks the ProofOfCall runtime for PUSH0 and Cancun opcodes before any broadcast | `test_chain_revert_buildOverride`, `test_checkBuild_*`, `test_loadConfig_readsEnv` |
| D9 | **Wrong or mistyped mainnet feed address** | Addresses cited to the QIE docs and checked on chain (code, 8 decimals, description, recent round); `isQieMainnetFeed` allowlist; config JSON cross-checked against the Solidity constants; the ps1 refuses unverified configs | `test_params_mainnetBtcEthOnly`, Pester `committed config lists exactly ...`, `refuses unverified feeds` |
| D10 | **Testnet settings or secrets leak into the mainnet run** (forge auto-loads `.env`; `ETH_PASSWORD` would unlock a keystore silently) | `deploy-mainnet.ps1` refuses to run while `.env` exists or key/`ETH_PASSWORD`/`CAST_PASSWORD` variables are set, and sets every `POC_*` value itself, process scope only, removed afterwards | Pester `refuses a .env file`, `cleans the environment` |
| D11 | **A stale broadcast file is recorded as the mainnet deploy** (e.g. after a rehearsal) | The record is only written from a broadcast file newer than this run, after `cast code` finds the contract on the target RPC and `Check.s.sol` passes; an existing record is never overwritten and blocks a second deploy | Pester `Get-PocBroadcastRun`, `refuses to deploy twice` |
| D12 | **`maxGap` too small for the real feed cadence** (calls void) or too large (stale prices) | `script/FeedCadence.s.sol` measures the last 96 rounds and recommends a value; it also checks the round-proof assumptions (plain ids, monotonic `updatedAt`, `answeredInRound`) | `test/FeedCadence.t.sol` |
| D13 | **Deployer is the owner's main wallet** | The runbook uses a fresh gas-only keystore (or Ledger); `POC_OWNER` is the MetaMask address; `POC_EXPECTED_DEPLOYER` is mandatory on mainnet | `test_params_revert_mainnetNoExpectedDeployer`, `test_deploy_revert_mainnetWrongSigner` |
## Publisher CLI (Q5)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| C1 | **Salt lost** (crash, deleted file): the call can never be revealed and expires as a MISS | The vault entry is written before the seal is sent; atomic replace with a `.bak` copy; lock file against concurrent writers; `list` finds seals that were never mined | `vault.test.ts`, lifecycle `spots a seal that was never mined` |
| C2 | **Vault file stolen or edited** | scrypt (N = 2^17) + AES-256-GCM, header authenticated as AAD, entries validated on load; file mode 0600; must live outside the repository | `rejects a wrong password and any tampering`, `keeps the vault outside the repository` |
| C3 | **Seal sent from the wrong account** (commitment bound to another publisher, can never be opened) | `--from` is required; the signing page refuses other accounts; cast signer compares the keystore/Ledger address first; mined `from` re-checked | `refuses to send from another account` (Chromium e2e), `sends nothing when the wallet is another address` |
| C4 | **A website drives the local signing page** (CSRF, DNS rebinding) | 127.0.0.1 only, 256-bit random path, exact `Host` and `Origin` checks, JSON only, one answer, timeout, nonce CSP, no external resources | `browser.test.ts` |
| C5 | **Wallet or RPC substitutes the transaction** | After mining, sender, contract, calldata, status and the `Sealed`/`Revealed` event are compared with what was prepared | `sendAndConfirm` in every lifecycle step |
| C6 | **Accidental mainnet transaction** | Chain id of the RPC checked; mainnet always asks for confirmation and refuses `--yes`; mainnet seals need verified feed addresses | `args.test.ts` |
| C7 | **Keys leak through the tool** | The CLI never sees a key: browser wallet, Foundry keystore (cast prompts) or Ledger; the unlocked signer only works on chain 31337 | `cast.test.ts`, `UnlockedSigner` chain check |

## Read layer (Q6)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| R1 | **RPC drops or invents events** (incomplete record shown) | Scorecards folded from events are cross-checked against the contract's `scorecard()`; events that do not fit are listed as anomalies, never dropped | lifecycle `read layer rebuilds ...`, `reports events that do not fit` |
| R2 | **Reorg frozen into the per-viewer cache** | Only blocks at least `reorgDepth` (15) behind the head are cached; the tail is always fetched again | `caches only blocks older than the reorg depth` |
| R3 | **Poisoned or stale cache** (another contract, edited storage) | Snapshot keyed by chain and contract, validated on load, ignored when unreadable | `ignores a cache of another contract, a corrupt cache ...` |
| R4 | **Calls scored against a non-QIE feed shown as official** | `describeFeed` flags any feed not listed for the network | `labels feeds and flags unknown ones` |

## Web app (Q7)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| W1 | **Third-party scripts or trackers** read visitors or change the page | No external scripts, styles or fonts; CSP `default-src 'none'`, own scripts and styles only; `connect-src` limited to the QIE RPC origins | `dist.test.ts` |
| W2 | **Page framed or opened with a leaking referrer** | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` (`vercel.json`), `noopener` on external links | `vercel.json` |
| W3 | **Contract makes the page fetch arbitrary URLs** (EIP-3668 CCIP-read) | `ccipRead: false` on every client (also in the CLI); the CSP would block it anyway | `dist.test.ts` (no unexpected hosts) |
| W4 | **Wrong or tampered opening** in a shared link reveals a different call | The opening must hash to the sealed commitment before the Reveal button appears; the contract checks it again | `pages.test.tsx` (`rejects an opening that does not match`) |
| W5 | **Opening leaks to a server** | It travels only in the URL fragment, which browsers never send; the CLI refuses to create links before the horizon | C-rows above, `unit.test.ts` |
| W6 | **XSS through on-chain strings** (labels, feed descriptions) | React escapes everything rendered; wallet icons only accepted as `data:image/` URIs | `pages.test.tsx` |
| W7 | **Data of another network shown under this one** after switching | Loaded state is keyed by chain id and discarded on mismatch | `useNetworkData` |

## Out of scope for Q1 / open items

- External audit and static analysis (Q10). Publisher CLI: `docs/CLI.md` (Q5); read layer: `docs/READ_LAYER.md` (Q6); web app: `docs/WEB.md` (Q7).
- Phase-encoded round ids across a phase boundary (see DESIGN known limitations).
- QIE's EVM level is undocumented; the Q2 probe found Shanghai level on testnet and mainnet (see `docs/DEPLOY.md`). We keep `paris`.
- Explorer source verification (commands in `docs/DEPLOY.md`). The mainnet runbook is `docs/MAINNET.md` (Q4).
