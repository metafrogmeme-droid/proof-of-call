# Q&A sheet

Short answers to the questions judges are likely to ask. The details behind each answer are in the docs named in brackets.

## The idea

**Why can't a publisher just delete bad calls?**
Calls are on chain. And a call that is never revealed can be expired by anyone after its deadline, where it counts as
a miss. Not revealing is never better than revealing a loss. (DESIGN §4)

**Why seal a hash instead of posting the call openly?**
Posting it openly would let others copy or front-run the signal. The hash proves the call existed at seal time
without giving it away. After the horizon it doesn't matter anymore, and it becomes public.

**Couldn't the publisher seal UP and DOWN at the same time and show only the winner?**
No. Both calls are on chain and both get scored (a hit and a miss); unrevealed ones expire as misses. The scorecard
shows every sealed call.

**What is a "verifier"?**
Any wallet other than the publisher's that reveals a call (from the shared reveal link) or expires an overdue one.
The app counts them from chain data. (READ_LAYER)

## Contract and oracle

**How do you stop someone from picking a convenient price?**
The reveal names two oracle round ids, and the contract proves each is *the first* round after its time by also
reading the round before it. There is exactly one such round. (DESIGN §2)

**What if the QIE Oracle stops updating?**
If no update comes within `maxGap` of the seal or of the horizon, the call is VOID. It is never scored on a stale or
guessed price. `maxGap` is chosen from the measured feed cadence. (MAINNET step 5)

**Can a publisher turn a losing call into VOID?**
No. A void needs a correct proof of a real stall or of bad data. A wrong or malformed round makes the reveal revert,
and then the call eventually expires as a miss. (THREAT_MODEL T10)

**What can the contract owner do?**
Add or retire feeds, change the defaults for *new* calls, and transfer or renounce ownership. The owner cannot change
any existing call, its rules or its outcome, and cannot move funds (there are none). (DESIGN §6)

**Is it upgradeable? Can it hold funds?**
Neither. There is no proxy, no `delegatecall` and no `selfdestruct`. It rejects value, and the only external calls are
read-only `STATICCALL`s to allowlisted feeds. A test walks the bytecode to enforce this.

**Why `evm_version = paris` on QIE?**
QIE's docs don't state an EVM level. We probed it (Shanghai yes, Cancun no) and pinned `paris`. The deploy scripts
refuse a build containing PUSH0 or Cancun opcodes. (DEPLOY)

**What does a call cost?**
A seal is one storage-heavy transaction. Gas on QIE is very cheap; the whole testnet deployment cost ~4.8 M gas at ~7 wei.

## Off chain

**Where is the secret salt kept?**
In an encrypted file on the publisher's machine (scrypt + AES-256-GCM). It is written *before* the seal is sent, with a
backup copy on every change. It is never logged and never leaves the machine until the reveal. (CLI)

**Does your tool ever see private keys?**
No. MetaMask signs through a one-time local page, a Foundry keystore signs inside `cast` (which asks for the password
itself), or a Ledger signs. The CLI checks that the mined transaction is exactly the prepared one.

**Is there a backend? Who hosts the data?**
No backend, no database. The web app is static and reads the chain in your browser, with a small cache in your own
browser. You can verify every proof with `cast` instead of using the app. (WEB)

**Do you track visitors?**
No analytics and no third-party scripts or fonts. The content security policy only allows connections to the QIE RPCs.

**What if the public RPC blocks browsers (CORS)?**
The app then reads through the connected wallet's RPC connection. Without a wallet it says so instead of showing
nothing. (READ_LAYER)

## QIE

**How exactly do you use QIE?**
The contract runs on QIE testnet and mainnet. Scores come from QIE Oracle feeds (BTC / USDT, ETH / USDT). The app works
with QIE Wallet and MetaMask, adds the QIE network to the wallet, reads the QIE RPCs and links every transaction to the
QIE explorers.

**Why mock feeds on testnet?**
QIE testnet has no oracle contracts (`eth_getCode` is empty), so testnet uses our test feed. It is labelled "test
mock" in the app, and the deploy scripts make sure mainnet only ever uses the official QIE Oracle feeds.

## Quality and status

**Is it audited?**
Not externally. We did a written self-review with findings and fixes (`docs/AUDIT.md`), keep a threat model where every
mitigation has a test, and run 200+ contract tests plus end-to-end tests in a real browser.

**What did you find in your own review?**
For example: a cached block number could make the app miss the newest events (fixed), and viem's CCIP-read could let a
contract trigger arbitrary URL fetches (disabled). Full list in AUDIT.md.

**What was built during the hackathon?**
Everything in the repository. RUNECLAW's earlier HashKey entry was a design reference only; no code was reused.
(README, "What was built during the hackathon")

**How many calls and users do you have?**
Read the live numbers from the web app: sealed calls, revealed calls, verifier wallets, all counted from the chain.
The target for the hackathon is 20+ sealed calls and 5+ verifier wallets.

**What's next?**
More publishers (AI agents sealing from their own wallets), more QIE Oracle assets, salt recovery from a wallet
signature, an external audit, and later paid signals on proven track records.
