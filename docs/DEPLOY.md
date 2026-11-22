# Deploying ProofOfCall (QIE testnet)

Status: **live on QIE testnet (chain 1983) since 1 Nov 2026**, see [Live testnet deployment](#live-testnet-deployment-chain-1983)
and `deployments/qie-testnet-1983.json`. Mainnet (chain 1990) is **not** deployed; it is the owner's own step in
Q11 and is refused by default.

## Live testnet deployment (chain 1983)

Deployed 1 Nov 2026 18:59:56 CET (17:59:56 UTC) with `script/deploy.sh --broadcast` from commit `8b8e7eb`
(solc 0.8.28, `evm_version = "paris"`, optimizer 200 runs). Machine-readable copy: `deployments/qie-testnet-1983.json`.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| `ProofOfCall` | [`0xb6567DB95934ec74fabe4823D0c07125bfc29C54`][poc] | [`0xaa83a9b3…2f1a574`][poc-tx] | 9507635 |
| `MockAggregatorV3` "BTC / USD" | [`0xa1141220424Fc103d1631BAd44039CEc0C4B6D28`][btc] | [`0x7c0045e7…d2f86db`][btc-tx] | 9507633 |
| `MockAggregatorV3` "ETH / USD" | [`0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82`][eth] | [`0xed2a4e06…666a42c`][eth-tx] | 9507634 |

| Role / setting | Value |
|---|---|
| Owner | `0x020A4366595292aa16184536bAB2E9949d0D925F` (the owner's MetaMask), set in the constructor; `pendingOwner` = `0x0`, nothing to accept |
| Deployer | `0x8D0C4933Bbac89B99d0a94De8810049D5f8F3689` (fresh testnet-only keystore; also the admin of both mocks) |
| `defaultMaxGap` | `21600` s (6 h) |
| `defaultFlatBandBps` | `10` (0.10 %) |
| Feed allowlist | both mocks, `addedAt` = 1793555996, `retiredAt` = 0 |
| Explorer | `https://testnet.qie.digital` (Blockscout v7.0.2, paths `/address/<addr>` and `/tx/<hash>`) |

[poc]: https://testnet.qie.digital/address/0xb6567DB95934ec74fabe4823D0c07125bfc29C54
[poc-tx]: https://testnet.qie.digital/tx/0xaa83a9b3a215f6a3ff86c6b7e0aea608c13e4ebc6fc17778f9c91d5832f1a574
[btc]: https://testnet.qie.digital/address/0xa1141220424Fc103d1631BAd44039CEc0C4B6D28
[btc-tx]: https://testnet.qie.digital/tx/0x7c0045e74785630a83c235c2920b475304542a12695bee4c23e254d08d2f86db
[eth]: https://testnet.qie.digital/address/0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82
[eth-tx]: https://testnet.qie.digital/tx/0xed2a4e06738051b94475aa0894e98d5549792ea10b8a58bfaa6f69371666a42c

### On-chain check (1 Nov 2026, via rpc2, read-only)

All values above were read back from chain 1983 over `https://rpc2testnet.qie.digital/`:

- `eth_chainId` = 1983; all three deploy receipts have `status` = 1 and `from` = the deployer.
- `ProofOfCall`: `owner()` = `0x020A…925F`, `pendingOwner()` = `0x0`, `defaultMaxGap()` = 21600,
  `defaultFlatBandBps()` = 10, `feedState(feed)` = (1793555996, 0) and `isFeedAllowedAt(feed, now)` = true for both mocks.
- Mocks: `decimals()` = 8, `description()` = "BTC / USD" / "ETH / USD", `admin()` = the deployer, `version()` = 1.
- Code present: `ProofOfCall` 9777 bytes, each mock 2874 bytes. The `ProofOfCall` runtime code is byte-identical
  to a local `forge build` of `8b8e7eb`; the mocks are identical once the `admin` immutable is filled in. The creation
  input of each deploy tx equals the local creation code plus the ABI-encoded constructor arguments.
- `script/Check.s.sol` passes (owner, both defaults, 2 feeds, 8 decimals, mock admin):

```sh
POC_EXPECTED_CHAIN_ID=1983 \
POC_ADDRESS=0xb6567DB95934ec74fabe4823D0c07125bfc29C54 \
POC_OWNER=0x020A4366595292aa16184536bAB2E9949d0D925F \
POC_MAX_GAP=21600 POC_FLAT_BAND_BPS=10 \
POC_CHECK_FEEDS=0xa1141220424Fc103d1631BAd44039CEc0C4B6D28,0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82 \
POC_MOCK_ADMIN=0x8D0C4933Bbac89B99d0a94De8810049D5f8F3689 \
forge script script/Check.s.sol:Check --rpc-url https://rpc2testnet.qie.digital/
```

The mock prices are empty (`latestRound()` = 0) until the mock admin pushes rounds; that is a separate step.

### Explorer source verification (not done yet)

On 1 Nov 2026 the three contracts are **not** source-verified on `testnet.qie.digital`
(`/api/v2/smart-contracts/<addr>` returns no `is_verified`). Verifying publishes the full Solidity source on the
public explorer, so it waits until the owner decides to make the source public (QIE's submission needs a public
repo anyway). Blockscout needs no API key. Commands (from this repo at `8b8e7eb`, same `foundry.toml`):

```sh
V="--chain 1983 --verifier blockscout --verifier-url https://testnet.qie.digital/api/ --watch"
forge verify-contract 0xb6567DB95934ec74fabe4823D0c07125bfc29C54 src/ProofOfCall.sol:ProofOfCall $V \
  --constructor-args "$(cast abi-encode 'constructor(address,uint32,uint16,address[])' \
    0x020A4366595292aa16184536bAB2E9949d0D925F 21600 10 \
    '[0xa1141220424Fc103d1631BAd44039CEc0C4B6D28,0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82]')"
forge verify-contract 0xa1141220424Fc103d1631BAd44039CEc0C4B6D28 src/mocks/MockAggregatorV3.sol:MockAggregatorV3 $V \
  --constructor-args "$(cast abi-encode 'constructor(string)' 'BTC / USD')"
forge verify-contract 0xF0319b3Ab44A85A10cc1c1D800911CDADDe90f82 src/mocks/MockAggregatorV3.sol:MockAggregatorV3 $V \
  --constructor-args "$(cast abi-encode 'constructor(string)' 'ETH / USD')"
```

Add `--show-standard-json-input` to print the compiler input locally without submitting anything. Afterwards,
check `https://testnet.qie.digital/api/v2/smart-contracts/<addr>` for `"is_verified": true`.

## QIE testnet facts (checked 1 Nov 2026)

| | Value | Source |
|---|---|---|
| Chain id | `1983` (`0x7bf`) | [QIE docs: Access Mainnet or Testnet][s1], [QIE Wallet integration guide][s2]; `eth_chainId` on rpc2/rpc4/rpc5 returned `0x7bf` |
| RPC | `https://rpc2testnet.qie.digital/` (our default); `rpc4testnet`, `rpc5testnet` also work | [s1] lists `rpc1testnet` ... `rpc6testnet`. **On 1 Nov `rpc1testnet` failed the TLS handshake** (`unexpected eof`) and rpc3 did not answer; rpc2, rpc4 and rpc5 returned `0x7bf`. Use rpc2, rpc4 or rpc5 |
| Explorer | `https://testnet.qie.digital/` | [s1], [s2] |
| Gas token | `QIE`, 18 decimals | [s2] |
| Faucet | `https://www.qie.digital/faucet` | [s1], [s2] |
| Fees | EIP-1559 blocks (`baseFeePerGas` = 7 wei); gas price ~7 wei | `eth_getBlockByNumber`, `eth_gasPrice` |
| QIE Oracle feeds | **none on testnet** (`eth_getCode` = `0x`), so testnet uses `MockAggregatorV3` | Q1 check, see `docs/DESIGN.md` |
| Mainnet | chain `1990` (`0x7c6`), `https://rpc1mainnet.qie.digital/`, explorer `https://mainnet.qie.digital/` | [s1] |

QIE Wallet note [s2]: testnet is hidden until the testnet toggle is on in QIE Wallet settings.

[s1]: https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet
[s2]: https://docs.qie.digital/qie-wallet-integration-guide-for-websites
[s3]: https://docs.qie.digital/qie-oracle/deployed-contracts/table-of-assets-contract-mapping.md

### EVM version (open point from Q1)

QIE's docs do not state an EVM hardfork level (they only say "fully EVM compatible"). We probed it with
read-only `eth_call`s of tiny init-code snippets on 1 Nov 2026, on both testnet (rpc2) and mainnet (rpc1):

| Opcode | Fork | Testnet 1983 | Mainnet 1990 |
|---|---|---|---|
| baseline (`PUSH1`/`MSTORE`/`RETURN`) | Paris | works | works |
| `PUSH0` (0x5f) | Shanghai | **works** | **works** |
| `TSTORE`/`TLOAD` (0x5d/0x5c) | Cancun | `invalid opcode: opcode 0x5d not defined` | same |
| `MCOPY` (0x5e) | Cancun | `invalid opcode: opcode 0x5e not defined` | same |
| `BLOBBASEFEE` (0x4a) | Cancun | `invalid opcode: opcode 0x4a not defined` | same |

So QIE currently runs at **Shanghai** level: `paris` and `shanghai` both work, `cancun` does **not**.
We keep `evm_version = "paris"` (already tested in Q1, and `test/Bytecode.t.sol` keeps guarding against
`PUSH0`). Never compile for `cancun` (solc >= 0.8.25 defaults to cancun, so the explicit setting matters).
`deploy.sh` refuses any `FOUNDRY_*` override (e.g. `FOUNDRY_EVM_VERSION`). As a further check, a read-only
`eth_estimateGas` of the paris `ProofOfCall` creation code succeeded on both chains (~2.23 M gas), and a full
`forge script` simulation against live testnet state succeeded (~4.8 M gas for 2 mocks + ProofOfCall).

Probe snippets (read-only, anyone can re-run):

```sh
RPC=https://rpc2testnet.qie.digital/
cast call --rpc-url $RPC --create 0x60015f5260205ff3                 # PUSH0 -> returns 1
cast call --rpc-url $RPC --create 0x6007600a5d600a5c5f5260205ff3     # TSTORE -> invalid opcode
```

## What gets deployed (testnet)

1. One `MockAggregatorV3` per entry in `POC_MOCK_FEEDS` (1..8, e.g. `BTC / USD,ETH / USD`). Admin = the deployer.
2. `ProofOfCall(POC_OWNER, POC_MAX_GAP, POC_FLAT_BAND_BPS, <the mocks>)`.
3. A read-back in the same run (`script/PostDeployCheck.sol`): owner, no pending owner, both defaults, each
   feed on the allowlist with 8 decimals and the expected mock admin. Any mismatch reverts the script.

## Guards

| Guard | Where |
|---|---|
| RPC `eth_chainId` must equal `POC_EXPECTED_CHAIN_ID` | `deploy.sh` and again `Deploy.s.sol` (`block.chainid`) |
| Only chain 1983. 1990 needs `POC_MAINNET_GO=yes`, not in CI, no env key, official QIE Oracle feeds only, never a mock | `script/DeployConfig.sol`, `deploy.sh` |
| Any other chain (incl. anvil 31337, Ethereum 1, HashKey 133/177) refused | `DeployConfig.checkChain` |
| Constructor bounds checked before any transaction (owner != 0, maxGap 60 s..7 d, band <= 1000 bps) | `DeployConfig.checkParams` |
| Signer must equal `POC_EXPECTED_DEPLOYER`; the forge default sender is refused | `Deploy.s.sol` |
| Always simulate first; broadcast only with `--broadcast` and after typing the chain id | `deploy.sh` |
| No `FOUNDRY_*`/`DAPP_*` overrides (shell or `.env`) | `deploy.sh` |
| `.env` may not contain `*PRIVATE_KEY*`, `*MNEMONIC*`, `*SEED*`, `*PASSWORD*` variables | `deploy.sh` |
| `DEPLOYER_PRIVATE_KEY` only from the shell env, only on testnet, format-checked without printing | `deploy.sh`, `DeployConfig.checkChain` |

## Run a testnet deploy (owner)

Prerequisites: Foundry 1.8.6 (`foundryup -i v1.8.6`), this repo with submodules.

1. **Deployer address.** Create a fresh testnet-only key in a Foundry keystore (password-encrypted, under
   `~/.foundry/keystores/`, never in the repo):
   `cast wallet new` then `cast wallet import qie-testnet-deployer --interactive` (paste the key at the
   hidden prompt), or use a Ledger (`POC_LEDGER=yes`). Note its address: `cast wallet address --account qie-testnet-deployer`.
2. **Fund it** with testnet QIE from `https://www.qie.digital/faucet`. Costs are tiny (~4.8 M gas at ~7 wei).
3. **Config:** `cp .env.example .env`, then set `POC_EXPECTED_DEPLOYER`, `POC_KEYSTORE_ACCOUNT`,
   `POC_OWNER` (e.g. the MetaMask owner address), and keep or change `POC_MAX_GAP`/`POC_FLAT_BAND_BPS`/`POC_MOCK_FEEDS`.
4. **Dry run** (sends nothing): `script/deploy.sh`
5. **Deploy:** `script/deploy.sh --broadcast`, type `1983` when asked, enter the keystore password.
6. **Check:** put the printed addresses in `.env` (`POC_ADDRESS`, `POC_CHECK_FEEDS`, `POC_MOCK_ADMIN` = the
   deployer) and run `forge script script/Check.s.sol:Check --rpc-url "$QIE_RPC_URL"` (read-only, no key).
7. Open the printed explorer link. Source verification: see [Explorer source verification](#explorer-source-verification-not-done-yet).

Outputs: `broadcast/` (tx receipts) and `cache/` (forge writes "sensitive values", e.g. the RPC URL) are
gitignored. Do not share them blindly and never commit them.

## Not done yet

- Explorer source verification (commands above; waits for the owner's decision to publish the source).
- Mainnet deploy and runbook (Q11): the mainnet path exists only behind the guards above and is not used.
