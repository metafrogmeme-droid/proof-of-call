# Publisher CLI (`poc`)

The CLI seals market calls on chain from the publisher's own wallet and reveals them after their horizon. It also
expires unrevealed calls and creates reveal links for verifiers. It runs on the publisher's machine (written for
Windows PowerShell, works the same on macOS and Linux).

**Keys never touch this tool.** Every transaction is signed by your browser wallet (MetaMask, QIE Wallet extension), a
Foundry keystore or a Ledger. The CLI prepares the transaction, checks it, and afterwards verifies that the mined
transaction is exactly the one it prepared.

**Revealed calls are public.** Before reveal only a hash is on chain, and nobody can see the asset or the direction.
Revealing publishes them for good, together with the entry and exit prices and the outcome.

## What it does

| Command | What happens |
|---|---|
| `info` | Read-only: contract, owner, scoring defaults, feeds and their latest prices |
| `seal` | Draws a random 32-byte salt, computes the commitment, **writes the opening to your encrypted vault**, then sends `seal` |
| `reveal` | After the horizon: finds the two oracle round ids the contract will prove, simulates, sends `reveal`. The result is HIT / MISS / FLAT / VOID |
| `expire` | After the reveal deadline: closes an unrevealed call as a MISS (anyone can do this, for any publisher) |
| `list` | Your vault's calls with their live on-chain status (what to reveal now) |
| `share` | After the horizon: a reveal link for verifiers (the opening travels in the URL fragment) |
| `export` | After the horizon: the opening as a JSON file (`reveal --opening <file>` on any machine) |
| `mock-push` | Testnet/local only: the mock admin pushes a price round (QIE testnet has no oracle) |

Horizons are **4h** and **12h** (owner decision, 22 Nov 2026). Assets are **BTC** and **ETH**.

## Install (once)

1. **Node.js 22 LTS** (`winget install OpenJS.NodeJS.LTS`, or the installer from nodejs.org). Check: `node --version`.
2. **Foundry** only if you sign with a keystore or a Ledger (see `docs/MAINNET.md` step 1). Not needed for MetaMask.
3. In the repository folder:

```powershell
npm ci
npm run build
npm run -s poc -- --help
```

`npm run -s poc -- <command> ...` runs the CLI. All examples below use it.

## Seal a call (MetaMask)

```powershell
$P = '0x020A4366595292aa16184536bAB2E9949d0D925F'   # your publisher address (the account in MetaMask)
npm run -s poc -- seal --network mainnet --asset BTC --direction up --horizon 4h --from $P
```

1. First run only: it creates the vault (`%USERPROFILE%\.proof-of-call\vault.json`) and asks you twice for a new
   password (at least 12 characters). Afterwards it asks for that password once per command.
2. It prints the call (label such as `RC-0001`, asset, direction, horizon, target time, reveal deadline) and asks for confirmation.
3. It saves the opening to the vault, then prints a one-time link `http://127.0.0.1:<port>/<token>`. Open it in the
   browser that has MetaMask and click **Send with MetaMask**. The page asks MetaMask to switch to QIE (it adds the
   network if needed), checks that the selected account is `$P` and sends the transaction. MetaMask shows it before you confirm.
4. The terminal waits for the receipt, checks it, marks the call `sealed` and prints the proof page route.

The signing page has no external resources. Only your browser and the CLI can use it, it accepts one answer and then shuts down.

Keystore or Ledger instead of MetaMask: add `--signer account:<keystore name>` or `--signer ledger`. Cast asks for
the keystore password itself. The CLI first checks that the keystore address equals `--from`.

## Reveal

The reveal window opens at the call's target time (seal time + horizon) and closes at the reveal deadline, which is
target + maxGap + 24 h by default (`--reveal-window`, 2 h to 29 days). See what is due:

```powershell
npm run -s poc -- list --network mainnet
npm run -s poc -- reveal RC-0001 --network mainnet --from $P
```

The CLI reads the feed and picks the first oracle round after the seal (entry) and the first round after the target
(exit). These are exactly the rounds the contract proves. It shows the expected outcome before you confirm. If the
feed has not updated since the target yet, it says when to try again. If the feed stays silent for longer than
maxGap, the call becomes VOID instead of getting a guessed price.

**Reveal every call before its deadline.** After the deadline anyone can expire it, and it counts as a MISS.

## Verifiers (traction)

After a call's horizon, give verifiers a reveal link:

```powershell
npm run -s poc -- share RC-0001 --network mainnet --from $P --base-url https://<web app URL>
```

Anyone who opens the link can connect their wallet in the web app and click Reveal. The outcome is fixed by the oracle
and always credited to the publisher. Their address shows up as a verifier. The opening is in the part of the URL after
`#`, which browsers never send to a server. `share` and `export` refuse to work before the horizon, because the
opening would give the call away early.

## The vault

- One file, default `~/.proof-of-call/vault.json`. Choose another with `--vault <file>`; it must be outside the repository.
- Encrypted with your password (scrypt + AES-256-GCM, authenticated). Every save replaces the file atomically and
  keeps the previous version as `vault.json.bak`.
- **Back it up** (it stays encrypted) and do not lose the password. Without the vault a sealed call can never be
  revealed: it expires as a MISS. Nobody, including the contract owner, can recover a salt.
- An entry is written **before** the seal transaction is sent. If the transaction never makes it on chain, `list` shows
  `not sealed (transaction never mined)` and the label is skipped next time.

## Testnet notes

Testnet (chain 1983) uses our `MockAggregatorV3` feeds, because QIE testnet has no oracle contracts. Their prices only
change when the mock admin (the testnet deployer key) pushes a round:

```powershell
npm run -s poc -- mock-push --network testnet --asset BTC --price 65000.12 --from <mock admin> --signer account:qie-testnet-deployer
```

A testnet call needs one push after its seal (entry) and one after its target (exit). Without them it becomes VOID once
maxGap has passed. Mainnet uses the real QIE Oracle feeds, which nobody here can write to.

## Guard rails

- The RPC's chain id is checked against the network (testnet 1983, mainnet 1990, local 31337), and a list of QIE RPCs is
  tried in turn. Mainnet and testnet RPCs must be `https://`.
- Mainnet seals need verified feed addresses (`deployments/qie-mainnet-1990.config.json`). Every mainnet transaction asks
  for confirmation, and `--yes` is refused on mainnet.
- Every transaction is simulated first. After mining, sender, contract, calldata, status and the expected event are checked.
- Arguments are validated before the vault password is asked for.

## Troubleshooting

| Message | What to do |
|---|---|
| `no vault at ... yet` | Seal once first (it creates the vault), or pass `--vault` |
| `wrong vault password, or the vault file is damaged` | Retry the password. If the file is damaged, open the `.bak` copy with `--vault` |
| `the horizon has not passed yet` | Wait for the printed target time |
| `the feed has no round after the target yet` | Try again after the printed time (the oracle updates irregularly) |
| `the reveal window closed` | Too late: the call can only be expired (a MISS) |
| `Select account 0x... in the wallet` (signing page) | Switch MetaMask to the publisher account and click again |
| `no answer from the browser within 10 min` | If you confirmed in the wallet, check its activity, then run `list` before retrying |
| `the RPC answered chain id ...` | Wrong `--rpc`; leave it out to use the QIE RPCs |
