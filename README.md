# RUNECLAW Proof of Call

Tamper-proof track records for AI agents on QIE: every call is sealed on chain as a hash before its
outcome is known, then revealed and scored on chain against QIE Oracle price feeds. A call that is never
revealed counts as a miss; a stalled feed gives VOID instead of a guess.

Status: work in progress for QIE Mainnet Hackathon 3.0. **Testnet only. Nothing is deployed.**

## Layout

| Path | What |
|---|---|
| `src/ProofOfCall.sol` | Seal / reveal / expire, on-chain round proofs, HIT / MISS / FLAT / VOID, per-publisher scorecards |
| `src/interfaces/IAggregatorV3.sol` | Our own 5-function Chainlink-style feed interface (no external package) |
| `src/mocks/MockAggregatorV3.sol` | Testnet feed: 8 decimals, scripted rounds (QIE testnet has no oracle contracts) |
| `test/` | Unit, fuzz, invariant and bytecode tests |
| `docs/DESIGN.md`, `docs/THREAT_MODEL.md` | How it works and what it defends against |

## Run

```sh
git submodule update --init --recursive
forge fmt --check && forge build && forge test
forge coverage --report summary
```

## Origin

All code in this repository is new and written for the QIE hackathon. The idea of anchoring RUNECLAW's
calls on chain comes from our earlier HashKey Chain entry, which served as a design reference only; no
code from it is reused.

Licence: MIT (see `LICENSE`).
