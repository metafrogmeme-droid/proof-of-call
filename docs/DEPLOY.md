# Deploying ProofOfCall (Q2: QIE testnet tooling)

Status: tooling only. **Nothing is deployed.** A testnet deploy needs a funded deployer that the owner
controls; mainnet (chain 1990) is the owner's own step in Q11 and is refused by default.

## QIE testnet facts (checked 1 Nov 2026)

| | Value | Source |
|---|---|---|
| Chain id | `1983` (`0x7bf`) | [QIE docs: Access Mainnet or Testnet][s1], [QIE Wallet integration guide][s2]; `eth_chainId` on rpc2/rpc4/rpc5 returned `0x7bf` |
| RPC | `https://rpc1testnet.qie.digital/` (docs' recommended) ... `rpc6testnet` | [s1]. On 1 Nov rpc1 and rpc3 did not answer from our box; rpc2, rpc4, rpc5 did. Use any that answers |
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
7. Open the printed explorer link. Contract verification on testnet.qie.digital is a follow-up (`docs/VERIFY.md`).

Outputs: `broadcast/` (tx receipts) and `cache/` (forge writes "sensitive values", e.g. the RPC URL) are
gitignored. Do not share them blindly and never commit them.

## Not in this PR

- Any real deploy (testnet or mainnet).
- Contract verification on the explorer (API still to be checked) and `docs/VERIFY.md`.
- Mainnet runbook (Q11): the mainnet path exists only behind the guards above and is not used.
