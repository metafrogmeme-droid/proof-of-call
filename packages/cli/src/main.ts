#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  ASSETS,
  DEFAULT_REVEAL_WINDOW,
  parseDirection,
  parseDuration,
  parseHorizon,
  parseOpeningJson,
  parsePrice,
  requireAddress,
  type Asset,
  type NetworkKey,
} from '@proof-of-call/core';
import { openNetwork, DEFAULT_DEPLOYMENTS_DIR, type Ctx } from './context.js';
import { terminalIo, type Io } from './io.js';
import { makeSigner } from './signers/index.js';
import { MIN_PASSWORD_LENGTH, Vault } from './vault.js';
import { seal } from './commands/seal.js';
import { reveal } from './commands/reveal.js';
import { expire } from './commands/expire.js';
import { list } from './commands/list.js';
import { exportOpening, share } from './commands/share.js';
import { info } from './commands/info.js';
import { mockPush } from './commands/mockPush.js';

const HELP = `poc: Proof of Call publisher CLI

Usage: poc <command> --network testnet|mainnet|local [options]

Commands
  info                         contract, owner, defaults, feeds and latest prices (read-only)
  seal                         seal a new call (salt stored in your encrypted vault first)
      --asset BTC|ETH --direction up|down --horizon 4h|12h --from <publisher>
      [--label RC-0001] [--label-prefix RC] [--reveal-window 24h]
  reveal <label|callId>        reveal and score a call after its horizon (from the vault, or --opening <file>)
      --from <sender> [--publisher <addr>] [--opening <file>]
  expire <label|callId>        close an unrevealed call after its deadline (anyone; counts as a MISS)
      --from <sender> --publisher <addr>
  list                         your vault's calls with their live status
  share <label|callId>         reveal link for verifiers, only after the horizon
      --base-url <web app URL> [--publisher <addr>]
  export <label|callId>        write the opening as a JSON file, only after the horizon [--out <file>]
  mock-push                    testnet/local only: push a mock price round (mock admin)
      --asset BTC|ETH --price 65000.12 --from <admin>

Common options
  --signer browser|account:<keystore>|ledger   how transactions are signed (default: browser)
  --vault <file>               default ~/.proof-of-call/vault.json (outside the repo)
  --rpc <url>                  override the RPC (its chain id is checked)
  --deployments <dir>          default: this repo's deployments/
  --yes                        skip the confirmation (never on mainnet)

Keys never touch this tool: a browser wallet, a Foundry keystore or a Ledger signs. See docs/CLI.md.`;

const OPTIONS = {
  network: { type: 'string' },
  rpc: { type: 'string' },
  deployments: { type: 'string' },
  vault: { type: 'string' },
  signer: { type: 'string' },
  from: { type: 'string' },
  publisher: { type: 'string' },
  asset: { type: 'string' },
  direction: { type: 'string' },
  horizon: { type: 'string' },
  label: { type: 'string' },
  'label-prefix': { type: 'string' },
  'reveal-window': { type: 'string' },
  opening: { type: 'string' },
  'base-url': { type: 'string' },
  out: { type: 'string' },
  price: { type: 'string' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} satisfies ParseArgsConfig['options'];

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

export class UsageError extends Error {}

function need(values: Values, name: keyof Values): string {
  const v = values[name];
  if (typeof v !== 'string' || v.length === 0) throw new UsageError(`missing --${name}`);
  return v;
}

function parseNetwork(value: string): NetworkKey {
  if (value === 'testnet' || value === 'mainnet' || value === 'local') return value;
  throw new UsageError('--network must be testnet, mainnet or local');
}

function parseAsset(value: string): Asset {
  const a = ASSETS.find((x) => x === value.toUpperCase());
  if (!a) throw new UsageError(`--asset must be one of ${ASSETS.join(', ')}`);
  return a;
}

/** The vault must live outside the repository (or in its git-ignored salts/ folder). */
export function vaultPath(value: string | undefined): string {
  const path = resolve(value ?? join(homedir(), '.proof-of-call', 'vault.json'));
  const repo = resolve(DEFAULT_DEPLOYMENTS_DIR, '..');
  if ((path + sep).startsWith(repo + sep) && !path.startsWith(join(repo, 'salts') + sep)) {
    throw new UsageError('keep the vault outside the repository (default ~/.proof-of-call/vault.json)');
  }
  return path;
}

async function unlockVault(path: string, io: Io, create: boolean): Promise<Vault> {
  if (Vault.exists(path)) return Vault.open(path, await io.secret(`Vault password (${path}): `));
  if (!create) throw new Error(`no vault at ${path} yet (it is created by the first seal)`);
  io.out(`Creating a new encrypted vault at ${path}.`);
  io.out(
    'It holds the secret salts of your sealed calls. Without it a call can never be revealed and expires as a MISS:',
  );
  io.out('back the file up (it stays encrypted) and do not forget the password.');
  const pw = await io.secret(`New vault password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if ((await io.secret('Repeat the password: ')) !== pw) throw new Error('passwords differ');
  return Vault.create(path, pw);
}

export async function run(argv: readonly string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const command = positionals[0];
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    io.out(pkg.version);
    return;
  }
  if (values.help || !command || command === 'help') {
    io.out(HELP);
    return;
  }
  const ref = positionals[1];
  const network = parseNetwork(need(values, 'network'));
  const yes = values.yes === true;
  if (yes && network === 'mainnet') throw new UsageError('--yes is not allowed on mainnet');
  const ctx: Ctx = await openNetwork({ network, rpc: values.rpc, deploymentsDir: values.deployments });
  const signer = () =>
    makeSigner(values.signer ?? 'browser', ctx, (url) => {
      io.out(`Open this link in the browser that has your wallet (one-time, local only):\n  ${url}`);
    });
  const from = () => requireAddress(need(values, 'from'), '--from');
  const needRef = () => {
    if (!ref) throw new UsageError(`${command} needs a call label or id`);
    return ref;
  };

  switch (command) {
    case 'info':
      return info(ctx, io);
    case 'seal': {
      // Validate every argument before asking for the vault password.
      const opts = {
        asset: parseAsset(need(values, 'asset')),
        direction: parseDirection(need(values, 'direction')),
        horizon: parseHorizon(need(values, 'horizon')),
        from: from(),
        label: values.label,
        labelPrefix: values['label-prefix'] ?? 'RC',
        revealWindow: values['reveal-window'] ? parseDuration(values['reveal-window']) : DEFAULT_REVEAL_WINDOW,
        yes,
      };
      const path = vaultPath(values.vault);
      await seal(ctx, signer(), await unlockVault(path, io, true), opts, io);
      return;
    }
    case 'reveal': {
      const opts = {
        ref: values.opening ? 'opening' : needRef(),
        from: from(),
        publisher: values.publisher ? requireAddress(values.publisher, '--publisher') : undefined,
        yes,
      };
      const source = values.opening
        ? { opening: parseOpeningJson(readFileSync(values.opening, 'utf8')) }
        : { vault: await unlockVault(vaultPath(values.vault), io, false) };
      await reveal(ctx, signer(), source, opts, io);
      return;
    }
    case 'expire':
      return expire(
        ctx,
        signer(),
        { ref: needRef(), publisher: requireAddress(need(values, 'publisher'), '--publisher'), from: from(), yes },
        io,
      );
    case 'list':
      await list(ctx, await unlockVault(vaultPath(values.vault), io, false), io);
      return;
    case 'share': {
      const opts = {
        ref: needRef(),
        publisher: requireAddress(values.publisher ?? need(values, 'from'), '--publisher'),
        baseUrl: need(values, 'base-url'),
      };
      await share(ctx, await unlockVault(vaultPath(values.vault), io, false), opts, io);
      return;
    }
    case 'export': {
      const opts = {
        ref: needRef(),
        publisher: requireAddress(values.publisher ?? need(values, 'from'), '--publisher'),
        out: values.out,
      };
      await exportOpening(ctx, await unlockVault(vaultPath(values.vault), io, false), opts, io);
      return;
    }
    case 'mock-push':
      await mockPush(
        ctx,
        signer(),
        { asset: parseAsset(need(values, 'asset')), answer: parsePrice(need(values, 'price')), from: from(), yes },
        io,
      );
      return;
    default:
      throw new UsageError(`unknown command "${command}" (see poc --help)`);
  }
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href;
if (isMain) {
  const io = terminalIo();
  run(process.argv.slice(2), io).then(
    () => process.exit(0),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      io.warn(`error: ${message}`);
      process.exit(err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS') ? 2 : 1);
    },
  );
}
