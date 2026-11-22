# Explorer source verification (Blockscout)

**Verifying publishes the full Solidity source on the public explorer.** It is the owner's decision and is not done
automatically by anything in this repository. The commands below are ready to run when the owner decides. Blockscout
needs no API key.

All commands use this repository at the commit recorded in the deployment record (`sourceCommit`), with the committed
`foundry.toml` (solc 0.8.28, `evm_version = "paris"`, optimizer 200 runs, `bytecode_hash = "ipfs"`).

## 0. Check privately first (publishes nothing)

Compare the deployed runtime code with a local build. For `ProofOfCall` (no immutables) the two must be byte-identical:

```sh
forge build
RPC=https://rpc2testnet.qie.digital/          # mainnet: https://rpc1mainnet.qie.digital/
ADDR=0xb6567DB95934ec74fabe4823D0c07125bfc29C54
diff <(cast code $ADDR --rpc-url $RPC) <(forge inspect ProofOfCall deployedBytecode) && echo identical
```

To print the exact compiler input Blockscout would receive, again without submitting anything, add
`--show-standard-json-input` to any `forge verify-contract` command below.

## 1. QIE testnet (chain 1983)

Addresses and constructor arguments from `deployments/qie-testnet-1983.json` (source commit `8b8e7eb`):

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

## 2. QIE mainnet (chain 1990), after the owner's deployment

Take the address, `maxGap` and `flatBandBps` from `deployments/qie-mainnet-1990.json` (written by
`script/deploy-mainnet.ps1`). The feeds are the QIE Oracle BTC / USDT and ETH / USDT feeds, in this order. Only
`ProofOfCall` is verified on mainnet: the QIE Oracle feeds are QIE's own contracts.

Windows PowerShell:

```powershell
$r = Get-Content deployments\qie-mainnet-1990.json -Raw | ConvertFrom-Json
$p = $r.contracts.ProofOfCall
git checkout $r.sourceCommit
$feeds = '[' + ($p.constructorArgs.feeds -join ',') + ']'
$ctorArgs = cast abi-encode 'constructor(address,uint32,uint16,address[])' $p.constructorArgs.initialOwner $p.constructorArgs.maxGap $p.constructorArgs.flatBandBps $feeds
forge verify-contract $p.address src/ProofOfCall.sol:ProofOfCall --chain 1990 --verifier blockscout `
  --verifier-url https://mainnet.qie.digital/api/ --watch --constructor-args $ctorArgs
```

bash:

```sh
R=deployments/qie-mainnet-1990.json
ADDR=$(jq -r .contracts.ProofOfCall.address $R)
ARGS=$(cast abi-encode 'constructor(address,uint32,uint16,address[])' \
  "$(jq -r .contracts.ProofOfCall.constructorArgs.initialOwner $R)" \
  "$(jq -r .contracts.ProofOfCall.constructorArgs.maxGap $R)" \
  "$(jq -r .contracts.ProofOfCall.constructorArgs.flatBandBps $R)" \
  "[$(jq -r '.contracts.ProofOfCall.constructorArgs.feeds | join(",")' $R)]")
forge verify-contract "$ADDR" src/ProofOfCall.sol:ProofOfCall --chain 1990 --verifier blockscout \
  --verifier-url https://mainnet.qie.digital/api/ --watch --constructor-args "$ARGS"
```

## 3. Check the result

```sh
curl -s https://testnet.qie.digital/api/v2/smart-contracts/0xb6567DB95934ec74fabe4823D0c07125bfc29C54 | jq .is_verified
```

(mainnet: `https://mainnet.qie.digital/api/v2/smart-contracts/<address>`). Then set `"explorerVerified": true` in
the deployment record and commit it.
