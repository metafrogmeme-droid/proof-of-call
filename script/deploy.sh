#!/usr/bin/env bash
# Deploy MockAggregatorV3 feed(s) + ProofOfCall to QIE testnet (chain 1983).
#
#   script/deploy.sh            # checks + simulation only, never sends a transaction
#   script/deploy.sh --broadcast  # checks + simulation, then asks you to type the chain id, then sends
#
# Config comes from the environment (see .env.example; Foundry also loads ./.env).
# Signer, in order of preference:
#   POC_LEDGER=yes                  hardware wallet (--ledger)
#   POC_KEYSTORE_ACCOUNT=<name>     Foundry keystore (cast wallet import <name> --interactive); password prompted
#   DEPLOYER_PRIVATE_KEY (shell env only, testnet only, never in .env or any file)
#
# Mainnet (1990) is refused by Deploy.s.sol unless POC_MAINNET_GO=yes, outside CI, with ledger/keystore,
# and with official QIE Oracle feeds only. This script never prints keys or passwords.
set -euo pipefail
set +x

cd "$(dirname "$0")/.."

die() { echo "deploy.sh: $*" >&2; exit 1; }

BROADCAST=0
case "${1:-}" in
  "") ;;
  --broadcast) BROADCAST=1 ;;
  *) die "unknown argument (use no argument for a dry run, or --broadcast)" ;;
esac

command -v forge >/dev/null || die "forge not found"
command -v cast >/dev/null || die "cast not found"

# 1. No FOUNDRY_*/DAPP_* overrides: they could silently change evm_version, optimizer or the sender.
if [ -f .env ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?(FOUNDRY|DAPP)_' .env; then
  die ".env sets FOUNDRY_* or DAPP_* variables; remove them (they override foundry.toml)"
fi
if env | grep -qE '^(FOUNDRY|DAPP)_'; then
  die "unset all FOUNDRY_* and DAPP_* variables first (they override foundry.toml): $(env | grep -oE '^(FOUNDRY|DAPP)_[A-Z0-9_]*' | tr '\n' ' ')"
fi

# 2. Keys never live in files. Check names only; values are never read or printed.
if [ -f .env ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]*(PRIVATE_KEY|MNEMONIC|SEED|PASSWORD)[A-Z0-9_]*[[:space:]]*=' .env; then
  die ".env contains a key, mnemonic, seed or password variable. Remove it; use a keystore or ledger."
fi

# Load ./.env (the same file Foundry loads), after the checks above.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# 3. Required config.
: "${QIE_RPC_URL:?set QIE_RPC_URL (e.g. https://rpc2testnet.qie.digital/)}"
: "${POC_EXPECTED_CHAIN_ID:?set POC_EXPECTED_CHAIN_ID (1983 for QIE testnet)}"
: "${POC_EXPECTED_DEPLOYER:?set POC_EXPECTED_DEPLOYER (the funded address that signs)}"
: "${POC_OWNER:?set POC_OWNER}"
: "${POC_MAX_GAP:?set POC_MAX_GAP (seconds)}"
: "${POC_FLAT_BAND_BPS:?set POC_FLAT_BAND_BPS}"
ZERO=0x0000000000000000000000000000000000000000
[ "$POC_EXPECTED_DEPLOYER" != "$ZERO" ] || die "POC_EXPECTED_DEPLOYER is the zero address"
[ "$POC_OWNER" != "$ZERO" ] || die "POC_OWNER is the zero address"

# 4. The RPC must really be the chain we expect (checked again inside Deploy.s.sol).
RPC_CHAIN_ID="$(cast chain-id --rpc-url "$QIE_RPC_URL")" || die "RPC did not answer eth_chainId; try another QIE RPC"
[ "$RPC_CHAIN_ID" = "$POC_EXPECTED_CHAIN_ID" ] || die "RPC chain id $RPC_CHAIN_ID != POC_EXPECTED_CHAIN_ID $POC_EXPECTED_CHAIN_ID"
case "$RPC_CHAIN_ID" in
  1983) EXPLORER="https://testnet.qie.digital" ;;
  1990)
    EXPLORER="https://mainnet.qie.digital"
    [ "${POC_MAINNET_GO:-}" = "yes" ] || die "mainnet refused (needs POC_MAINNET_GO=yes and the owner's go)"
    [ -z "${CI:-}" ] || die "mainnet refused in CI"
    ;;
  *) die "chain $RPC_CHAIN_ID refused: only QIE testnet 1983 (mainnet 1990 needs POC_MAINNET_GO=yes)" ;;
esac

# 5. Signer. Exactly one kind: Deploy.s.sol prefers DEPLOYER_PRIVATE_KEY when it is set.
if [ -n "${DEPLOYER_PRIVATE_KEY:-}" ] && { [ "${POC_LEDGER:-}" = "yes" ] || [ -n "${POC_KEYSTORE_ACCOUNT:-}" ]; }; then
  die "both DEPLOYER_PRIVATE_KEY and a ledger/keystore are set; unset DEPLOYER_PRIVATE_KEY"
fi
SIGNER_ARGS=()
if [ "${POC_LEDGER:-}" = "yes" ]; then
  SIGNER_ARGS=(--ledger --sender "$POC_EXPECTED_DEPLOYER")
  SIGNER_DESC="ledger"
elif [ -n "${POC_KEYSTORE_ACCOUNT:-}" ]; then
  SIGNER_ARGS=(--account "$POC_KEYSTORE_ACCOUNT" --sender "$POC_EXPECTED_DEPLOYER")
  SIGNER_DESC="keystore account '$POC_KEYSTORE_ACCOUNT'"
elif [ -n "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  [ "$RPC_CHAIN_ID" = "1983" ] || die "DEPLOYER_PRIVATE_KEY is testnet only; use POC_LEDGER or POC_KEYSTORE_ACCOUNT"
  [[ "$DEPLOYER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || die "DEPLOYER_PRIVATE_KEY has the wrong format (0x + 64 hex); value not shown"
  SIGNER_ARGS=(--sender "$POC_EXPECTED_DEPLOYER")
  SIGNER_DESC="DEPLOYER_PRIVATE_KEY from the shell env (testnet only)"
else
  die "no signer: set POC_LEDGER=yes, POC_KEYSTORE_ACCOUNT, or (testnet only) export DEPLOYER_PRIVATE_KEY in this shell"
fi

BALANCE="$(cast balance "$POC_EXPECTED_DEPLOYER" --rpc-url "$QIE_RPC_URL")"
echo "chain     $RPC_CHAIN_ID ($EXPLORER)"
echo "deployer  $POC_EXPECTED_DEPLOYER (balance $BALANCE wei) via $SIGNER_DESC"
echo "owner     $POC_OWNER"
echo "maxGap    $POC_MAX_GAP s, flatBand $POC_FLAT_BAND_BPS bps"
[ "$BALANCE" != "0" ] || echo "warning: deployer balance is 0; fund it from https://www.qie.digital/faucet before --broadcast" >&2

# 6. Always simulate first (no --broadcast: nothing is sent).
echo "== simulation"
forge script script/Deploy.s.sol:Deploy --rpc-url "$QIE_RPC_URL" "${SIGNER_ARGS[@]}"

[ "$BROADCAST" = "1" ] || { echo "== dry run only; re-run with --broadcast to send"; exit 0; }

# 7. Explicit confirmation, then broadcast (one tx at a time).
read -r -p "Type the chain id ($RPC_CHAIN_ID) to broadcast for real: " CONFIRM
[ "$CONFIRM" = "$RPC_CHAIN_ID" ] || die "not confirmed; nothing sent"
echo "== broadcast"
forge script script/Deploy.s.sol:Deploy --rpc-url "$QIE_RPC_URL" "${SIGNER_ARGS[@]}" --broadcast --slow
echo "== done. Receipts in broadcast/ (gitignored). Next: run script/Check.s.sol (see docs/DEPLOY.md)."
