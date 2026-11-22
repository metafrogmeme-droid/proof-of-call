# Demo video script (about 4 minutes)

For Patrick to record after the mainnet deployment. Every step is something the product really does. Numbers on
screen (calls, verifiers) must be read from the live web app on the day, never typed in.

## Before recording

- [ ] Mainnet deployed, `deployments/qie-mainnet-1990.json` committed, web app rebuilt and shows **Mainnet**.
- [ ] A handful of calls sealed earlier, at least one of them **past its horizon and not yet revealed** (for the live
      reveal), and its reveal link ready: `npm run -s poc -- share <label> --network mainnet --from <you> --base-url <app URL>`.
- [ ] A second browser profile with a **different wallet** (the "verifier") holding a little QIE for gas.
- [ ] Terminal font large (18 pt+), browser zoom 110–125 %, 1920×1080, notifications off.
- [ ] Nothing secret on screen, ever: the vault password prompt shows nothing, but do not type near the camera. No
      seed phrases, no keystore files, no `.env`, no password manager. Close unrelated tabs.
- [ ] Fallback if the mainnet RPC is slow: use testnet (say "testnet" on screen) or the local chain from the README.

## Shot list

| Time | On screen | Say (roughly) |
|---|---|---|
| 0:00–0:20 | Title card "Proof of Call, on QIE", then a mock "95 % win rate" signal post | "Every trading bot and signal seller claims a great hit rate. None of it can be checked: losing calls get deleted, winners get reposted." |
| 0:20–0:50 | Web app, **How it works** page | "Proof of Call fixes that on QIE. A call is sealed on chain as a hash *before* the outcome is known. After its horizon it is revealed, and the contract itself scores it against the QIE Oracle price. Nobody can edit it, drop it or pick a better price, not even me." |
| 0:50–1:40 | Terminal: `npm run -s poc -- seal --network mainnet --asset BTC --direction up --horizon 4h --from <you>`. Vault password (hidden), summary, `y`, signing link → MetaMask confirm → terminal "sealed" | "I seal a BTC call for the next four hours from my own wallet. The salt stays in an encrypted vault on my machine, and the tool never sees my key: MetaMask signs." |
| 1:40–2:00 | Web app: the new call's **proof page** ("Sealed, waiting", commitment, "hidden until revealed") | "On chain there is only this hash. Nobody can see which asset or which direction until I reveal it." |
| 2:00–2:50 | Second browser profile (verifier wallet): open the **reveal link** of an older call → "opening matches" → Connect wallet → **Reveal (public)** → result card, *verifier* badge, **Verify it yourself** all green, explorer tx | "This call's horizon has passed. I shared its reveal link, and here a different wallet reveals it. The contract proved which oracle rounds count, the first price after the seal and the first after the horizon, and scored it. The page re-checks the hash and the oracle rounds right in the browser. The result counts for me, and this wallet counts as a verifier." |
| 2:50–3:20 | **Publisher page**: scorecard, "Matches the contract's own scorecard()", calls list, verifier wallets | "This is my public track record: hits, misses, flats, voids. A call I don't reveal in time can be expired by anyone, and it counts as a miss, so I can't hide losers. If the oracle stalls, the call is void instead of guessed." |
| 3:20–3:40 | Quick cuts: README "Hard properties", test run in the terminal, CI checks on a PR | "The contract holds no funds, is not upgradeable, and only reads the QIE Oracle. The owner cannot touch any existing call. 200+ contract tests, fuzzing and invariants, end-to-end tests in a real browser, and a written threat model." |
| 3:40–4:00 | Network overview: sealed calls, revealed, verifier wallets (live numbers) | "It's live on QIE mainnet: [N] calls sealed, [M] verifier wallets so far, all counted from the chain. Proof of Call: track records you don't have to trust." |

## After recording

- Check that no address other than public ones (your publisher wallet, contract, verifier) is readable.
- Upload. Put the link in the submission form (the owner submits).
