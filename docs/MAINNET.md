# Deploying ProofOfCall to QIE mainnet (owner runbook, Windows PowerShell)

Status: **not deployed.** This is the owner's own step (planned 25–26 Nov 2026), run from the owner's machine with
the owner's wallet. Nothing in this runbook sends a transaction until step 7, and even then only after you type `1990`.

Before step 6 you need a version of this repo where `deployments/qie-mainnet-1990.config.json` says
`"feedVerification": {"status": "verified", ...}`. The deploy script refuses unverified feed addresses.

## What gets deployed

One contract, `ProofOfCall(owner, maxGap, flatBandBps, feeds)`:

| Argument | Value |
|---|---|
| `owner` | your MetaMask address `0x020A4366595292aa16184536bAB2E9949d0D925F` (can manage the feed list and defaults; cannot touch any call) |
| `maxGap` | from step 5 (seconds) |
| `flatBandBps` | `10` (0.10 %), same as testnet |
| `feeds` | the official QIE Oracle **BTC / USD** and **ETH / USD** feeds only (owner decision, 22 Nov); more can be added later with `addFeeds` |

No mock feed is ever deployed on mainnet. The contract holds no funds, accepts no value and cannot be upgraded.
The deployer key has **no rights** after the deployment: it only pays the gas.

### Feed addresses

| Pair | Address | Source |
|---|---|---|
| BTC / USD | `0x9E596d809a20A272c788726f592c0d1629755440` | [QIE docs: Table of Assets → Contract Mapping][qie-feeds] |
| ETH / USD | `0x4bb7012Fbc79fE4Ae9B664228977b442b385500d` | same page |

The same two addresses are in `script/DeployConfig.sol` (`QIE_MAINNET_BTC_USD`, `QIE_MAINNET_ETH_USD`) and in
`deployments/qie-mainnet-1990.config.json`; a Pester test fails if they ever differ. Verification status and evidence
live in the `feedVerification` block of that config file. You can re-check them yourself at any time (read-only):

```powershell
$R = 'https://rpc1mainnet.qie.digital/'
foreach ($f in '0x9E596d809a20A272c788726f592c0d1629755440', '0x4bb7012Fbc79fE4Ae9B664228977b442b385500d') {
    cast call $f 'description()(string)' --rpc-url $R
    cast call $f 'decimals()(uint8)' --rpc-url $R
    cast call $f 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url $R
}
```

Expected: `BTC / USD` / `ETH / USD`, `8`, and a recent round (plain round id, `updatedAt` a recent Unix time).

[qie-feeds]: https://docs.qie.digital/qie-oracle/deployed-contracts/table-of-assets-contract-mapping

## Rules for the whole run

- **Never paste a private key, seed phrase or password** into PowerShell, a file, a chat or an environment variable.
  The script refuses any `*PRIVATE_KEY*`, `*MNEMONIC*`, `*PASSWORD*` variable and never reads values.
- Use **one fresh PowerShell window**. Everything the script sets lives only in its own process and is removed at the end.
  Do not put `POC_*` variables in your PowerShell profile.
- If anything looks wrong before step 7, stop: nothing has been sent.

## 1. Install Foundry v1.8.6 (the version CI uses)

Either of:

- **Prebuilt binaries:** from the official release page `https://github.com/foundry-rs/foundry/releases/tag/v1.8.6`
  download the Windows (`win32_amd64`) zip, extract `forge.exe`, `cast.exe`, `anvil.exe` to e.g. `C:\foundry`, then in
  each new window: `$env:Path = "C:\foundry;$env:Path"`.
- **Git Bash:** `curl -L https://foundry.paradigm.xyz | bash`, then `foundryup -i v1.8.6`, and add
  `%USERPROFILE%\.foundry\bin` to `Path`.

Check: `forge --version` must show `1.8.6`. You also need Git for Windows.

## 2. Get the repo

```powershell
git clone https://github.com/metafrogmeme-droid/proof-of-call.git
cd proof-of-call
git submodule update --init --recursive
forge build
forge test
```

All tests must pass. If you have a testnet `.env` in the folder, move it out for this run (forge would load it, and
the script refuses to run while it is there):

```powershell
if (Test-Path .env) { Move-Item .env ..\proof-of-call.testnet.env }
```

## 3. Deployer wallet (fresh, gas only)

Recommended: a **new Foundry keystore** used only for this deployment. The key is generated and encrypted on your machine;
you only ever see the address.

```powershell
New-Item -ItemType Directory -Force "$HOME\.foundry\keystores" | Out-Null
cast wallet new "$HOME\.foundry\keystores" qie-mainnet-deployer
cast wallet address --account qie-mainnet-deployer
```

Choose a new password at the hidden prompt and keep it in your password manager. Note the address: that is `$Deployer`.

Alternative: a **Ledger** (Ethereum app open). `cast wallet address --ledger` shows the address at index 0. Use
`-Ledger` instead of `-Account ...` in steps 6 and 7.

## 4. Fund the deployer

The deployment needs about 2.3 M gas (measured with a read-only `eth_estimateGas` on mainnet, `docs/DEPLOY.md`).

```powershell
$R = 'https://rpc1mainnet.qie.digital/'
cast gas-price --rpc-url $R          # wei per gas
```

Send roughly 3 x (2,300,000 x gas price) wei of QIE from your MetaMask to `$Deployer`, then check:

```powershell
cast balance <Deployer> --ether --rpc-url $R
```

## 5. Choose `maxGap` (read-only)

`maxGap` is how late the first oracle update after a seal (or after the call's horizon) may come before the call is
scored `VOID` instead of HIT / MISS / FLAT. It also moves the reveal deadline: `revealBy >= horizon end + maxGap + 1 h`.
Too small: calls void whenever the feed is quiet. Too large: stale prices are accepted and expiries come late.

Measure the real update cadence of both feeds:

```powershell
forge script script/FeedCadence.s.sol:FeedCadence --rpc-url https://rpc1mainnet.qie.digital/
```

It prints the min / median / max gap between updates over the last 96 rounds, the time since the latest update, and a
recommended `POC_MAX_GAP` (1.5 x the worst gap, rounded up to 15 minutes, at least 1 hour). Use that value unless you
have a reason not to.

**Stop and report** if any feed shows `plain ids false`, `monotonic false`, `answered false` or `complete false`: the
on-chain round proofs assume plain, ordered round ids.

## 6. Dry run (sends nothing)

```powershell
$Owner    = '0x020A4366595292aa16184536bAB2E9949d0D925F'
$Deployer = '0x...'      # from step 3
$MaxGap   = 21600        # from step 5
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\deploy-mainnet.ps1 `
    -Owner $Owner -Deployer $Deployer -Account qie-mainnet-deployer -MaxGap $MaxGap
```

(`-ExecutionPolicy Bypass` applies to this one process only; it is needed because Windows blocks scripts by default.)

The script checks: no `FOUNDRY_*`/`DAPP_*`/key variables, no `CI`, no `.env`, verified feed addresses, Foundry present,
RPC chain id `1990`, both feeds have code and 8 decimals, the deployer has QIE. Then forge simulates the deployment
(it may ask for the keystore password) and runs every Solidity guard. It ends with `dry run only`.

### Optional but recommended: full rehearsal on a local fork

This runs the **whole** flow, including the confirmation, the broadcast and the read-back, against a private copy of
mainnet on your machine. Nothing reaches mainnet.

Window A:

```powershell
anvil --fork-url https://rpc1mainnet.qie.digital/ --auto-impersonate
```

Window B:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\deploy-mainnet.ps1 `
    -Owner $Owner -Deployer $Deployer -MaxGap $MaxGap -Rehearsal -RpcUrl http://127.0.0.1:8545 -Broadcast
```

`-Rehearsal` only accepts a local anvil, signs with anvil's impersonation (no key) and gives the deployer 100 fake QIE on
the fork. It writes no deployment record. Stop anvil (Ctrl+C) afterwards.

## 7. Deploy (the only step that sends a transaction)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\deploy-mainnet.ps1 `
    -Owner $Owner -Deployer $Deployer -Account qie-mainnet-deployer -MaxGap $MaxGap -Broadcast
```

1. Same checks and simulation as step 6.
2. Prompt `Type 1990 to broadcast (QIE MAINNET)`: type `1990`. Anything else stops with nothing sent.
3. forge broadcasts one transaction (`--slow`) and waits for the receipt (keystore password prompt again).
4. The script reads the contract back from the chain with `script/Check.s.sol`: owner, no pending owner, `maxGap`,
   `flatBandBps`, both feeds on the allowlist, 8 decimals, official QIE feeds only. Any mismatch fails loudly.
5. It writes `deployments/qie-mainnet-1990.json` and prints the explorer link.

## 8. Record the deployment

Open the printed link (`https://mainnet.qie.digital/address/<ProofOfCall>`). Then put the record into the repo so the
web app and the publisher CLI pick up the mainnet address:

```powershell
git checkout -b mainnet-record
git add deployments/qie-mainnet-1990.json
git commit -m "Record QIE mainnet deployment (chain 1990)"
git push -u origin mainnet-record
```

and open a pull request (or paste the file's contents into the session and it gets opened for you). Move your testnet
`.env` back if you moved it in step 2. The deployer keystore can be archived; it has no rights on the contract.

Explorer source verification is a separate decision (it publishes the source): see `VERIFY.md` once it exists.

## If something goes wrong

| Message | Meaning | What to do |
|---|---|---|
| `Unset these variables first ...` | a `FOUNDRY_*`/`DAPP_*` or key/password variable is set | `Remove-Item Env:NAME` (or open a fresh window) |
| `A .env file is in the repo folder` | forge would load it | move it out (step 2) |
| `Feed addresses in the config are not verified yet` | this repo version has unverified feeds | update to the version with `"status": "verified"` |
| `RPC chain id is ..., expected 1990` | wrong RPC | use `https://rpc1mainnet.qie.digital/` |
| `Feed ... has no code` / `expected 8` | the address is not a QIE Oracle feed on this chain | stop and report |
| `Deployer ... has no QIE for gas` | unfunded deployer | step 4 |
| `DEPLOY: signer is not POC_EXPECTED_DEPLOYER` | `-Deployer` is not the keystore/Ledger address | fix `-Deployer` (step 3) |
| `DEPLOY: FOUNDRY_*/DAPP_* override set ...` or `DEPLOY: PUSH0 in bytecode ...` | the build drifted from `foundry.toml` | fresh window, `forge clean`, `git status` must be clean |
| `already exists: ProofOfCall is already deployed` | a mainnet record is already there | do not deploy twice; check the explorer |
| broadcast interrupted | the transaction may or may not be mined | check the deployer address on the explorer and `broadcast\Deploy.s.sol\1990\run-latest.json` **before** retrying |

After a successful deployment nothing about existing calls can be changed. If a setting is wrong, the owner can
`setDefaults` (affects only new seals) or `addFeeds` / `retireFeed`; if the deployment itself is wrong, deploy a new
one and record it instead (no funds are ever held, so nothing is lost).

## Guard layers (for reviewers)

| Layer | Checks |
|---|---|
| `script/deploy-mainnet.ps1` (`MainnetDeploy.psm1`) | inputs, clean environment, verified config, RPC chain id, feed code and decimals, deployer balance, simulation first, typed `1990`, stale-broadcast refusal, on-chain code after the deploy, read-back, no overwrite of an existing record |
| `script/Deploy.s.sol` + `DeployConfig.sol` (inside forge) | `block.chainid == 1990 == POC_EXPECTED_CHAIN_ID`, `POC_MAINNET_GO=yes`, not CI, no env key, no build override variables, owner/maxGap/band bounds, official QIE feeds only, no duplicates, `POC_EXPECTED_DEPLOYER` set and equal to the signer, feeds have code, runtime has no PUSH0 or Cancun opcodes |
| `script/PostDeployCheck.sol` (same run) and `script/Check.s.sol` (read-back) | owner, pending owner, defaults, allowlist, feed code, 8 decimals, official QIE feeds only |

Tests: `test/Deploy.t.sol` (incl. an offline mainnet deployment against feed code etched at the official addresses),
`test/FeedCadence.t.sol`, `test/pwsh/MainnetDeploy.Tests.ps1` (Pester, run in CI on Windows PowerShell 5.1 and PowerShell 7).
