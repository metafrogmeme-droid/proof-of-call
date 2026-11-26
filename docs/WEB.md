# Web app (`apps/web`)

A static, read-only web app: scorecards per publisher, a proof page per call, wallet connect, and Reveal / Expire
buttons. It reads the QIE chain directly in the visitor's browser (owner decision D7). There is no backend, no
database, no server keys, no analytics and no third-party scripts or fonts.

## Pages (hash routes, so any static host works without rewrites)

| Route | Page |
|---|---|
| `#/net/<chainId>` | Network overview: contract, feeds, sealed/revealed counts, publishers with scorecards and hit rate, verifier wallets, latest calls |
| `#/publisher/<chainId>/<address>` | Scorecard of one publisher, confirmed against the contract's own `scorecard()`; all calls with status; verifier wallets |
| `#/call/<chainId>/<publisher>/<callId>` | Proof page: commitment, seal, target and deadline. After reveal: asset, direction, entry and exit round and price, outcome, revealer, and an in-browser re-check |
| `#/call/...?feed=..&dir=..&salt=..` | Reveal link: the proof page plus the opening, which only the publisher's `poc share` produces after the horizon |
| `#/about` | How it works |

**Layout:** a dark terminal theme (system fonts, no light default). A sticky header carries the brand, the network
switch with the active network as a pill (for example `QIE Mainnet · 1990`), the contract address and the wallet. On
desktop the overview has two columns: chain facts and a **Seal a Call** card on the left, the stat tiles and the latest
calls ledger on the right, then the publishers table. On a phone it is a single column. The Seal a Call card only
builds the publisher's `poc seal` command; sealing stays in the CLI and nothing is signed for it in the browser.
Addresses and hashes are shown truncated with a copy button. A revealed call shows its re-check as pass/fail rows,
with the Foundry line in a terminal block.

The network switch in the header lists Testnet, and Mainnet once its deployment record exists. Mainnet becomes the
default as soon as `deployments/qie-mainnet-1990.json` is in the build. Before that, the mainnet page says "not
deployed yet".

**Every page says what is public:** a sealed call shows only a hash. Once revealed, its asset, direction, prices and
outcome are public for good. Before a reveal, the reveal panel repeats this warning.

## Actions

- **Reveal**: available between the call's target time and its deadline. The opening comes from the reveal link
  (URL fragment, never sent to a server) or from an opening file (`poc export`). The app checks that the opening hashes
  to the sealed commitment, finds the oracle rounds the contract will prove, simulates, then asks the wallet to send.
  Any wallet can do this, and the outcome is credited to the publisher. A wallet that is not the publisher's counts as
  a **verifier**.
- **Expire**: available after the deadline. Any wallet can close an unrevealed call, and it counts as a miss.
- **Verify it yourself**: for a revealed call, the browser decodes the salt from the reveal transaction and recomputes
  the commitment. It also re-reads the entry and exit rounds (and the rounds before them) from the feed to show they
  were the first rounds after the seal and the target. A Foundry `cast call` line is shown as well.

## Wallets

Browser wallets are discovered via EIP-6963, with `window.ethereum` as fallback: MetaMask, the QIE Wallet extension,
and others. The app asks the wallet to switch to QIE, adding the network (chain id, RPCs, explorer, QIE currency) if
needed. There is no WalletConnect relay and no project id, so no third-party service is involved (owner decision D9:
wallet connect only).

## Reading the chain

See `docs/READ_LAYER.md`. Events are cached per browser in `localStorage`, and only blocks at least 15 behind the head
are cached. If the public QIE RPC refuses cross-origin requests, reads go through the connected wallet's provider
instead. CCIP-read is disabled, so a contract can never make the page fetch another URL.

## Security headers

- The built `index.html` carries a CSP: `default-src 'none'`, own scripts and styles only, and `connect-src` limited
  to the QIE RPC origins from the deployment records. Any other request is blocked by the browser.
- `apps/web/vercel.json` adds `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `no-referrer` and a
  restrictive `Permissions-Policy`.
- `apps/web/test/dist.test.ts` fails the build check if the bundle loads anything external, contains a local test
  network, or if a new URL host shows up in the bundled code.

## Run locally

```sh
npm ci
npm run dev:web                 # http://127.0.0.1:5173, testnet (and a local anvil deployment if deployments/local-31337.json exists)
npm run build:web               # static files in apps/web/dist
```

## Deploying (owner, later)

Any static host works: hash routes, relative asset paths. On Vercel, create a project from this repository with
**Root Directory** `apps/web`. `apps/web/vercel.json` already sets the install command (`npm ci --ignore-scripts` at
the repo root), the build command (`npm run build:web`), the output folder (`dist`) and the security headers. No
environment variables or secrets are needed. Redeploy after the mainnet deployment record is committed, so that the
app shows mainnet.

## Tests

- `apps/web/test/unit.test.ts`: routes (incl. reveal links), formatting, the networks compiled into the build.
- `apps/web/test/pages.test.tsx` (jsdom): overview, scorecard confirmed against `scorecard()`, a revealed proof page
  with the verifier badge. Also: a waiting call keeps asset and direction hidden; a matching vs a wrong opening; the
  expire panel; the public notice.
- `apps/web/test/copy.test.ts`: the user-facing copy rule (app, README, CLI guide).
- `apps/web/test/dist.test.ts`: CSP and external hosts of the production build.
- `apps/web/test/app.e2e.test.ts`: the built bundle in Chromium against anvil, with an injected wallet. Overview; a
  verifier reveals a call from a reveal link (HIT, verifier badge, all in-browser checks green); a call past its
  deadline is expired. Afterwards the scorecard and verifier list update, and there is no horizontal scroll at phone width.
