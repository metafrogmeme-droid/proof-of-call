import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrice, shareFragment, UP } from '@proof-of-call/core';
import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright';
import { build } from 'vite';
import type { Address } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockPush } from '../../../packages/cli/src/commands/mockPush.js';
import { seal } from '../../../packages/cli/src/commands/seal.js';
import { openNetwork, type Ctx } from '../../../packages/cli/src/context.js';
import { UnlockedSigner } from '../../../packages/cli/src/signers/unlocked.js';
import { Vault, type VaultEntry } from '../../../packages/cli/src/vault.js';
import { deployLocal, startAnvil, type Anvil } from '../../../packages/cli/test/helpers/anvil.js';
import { testIo } from '../../../packages/cli/test/helpers/io.js';

const H = 3600;
const webRoot = fileURLToPath(new URL('../', import.meta.url));

function launchOptions(): LaunchOptions {
  const path = process.env.POC_CHROMIUM_PATH;
  return path ? { executablePath: path } : { channel: 'chrome' };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serve(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` });
    });
  });
}

async function injectWallet(page: Page, anvil: Anvil, account: Address): Promise<void> {
  await page.exposeFunction('__pocWallet', async (method: string, params: unknown[]) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
    const res = await fetch(anvil.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { ethereum: unknown; __pocWallet: (m: string, p: unknown[]) => Promise<unknown> };
    w.ethereum = {
      request: ({ method, params }: { method: string; params?: unknown[] }) => w.__pocWallet(method, params ?? []),
    };
  });
}

describe('web app end to end (built bundle, Chromium, anvil)', () => {
  let anvil: Anvil;
  let ctx: Ctx;
  let browser: Browser;
  let server: Server;
  let appUrl: string;
  let publisher: Address;
  let verifier: Address;
  let revealable: VaultEntry;
  let overdue: VaultEntry;
  const shots = process.env.POC_SCREENSHOTS;

  beforeAll(async () => {
    anvil = await startAnvil();
    const [admin = '0x', first = '0x', second = '0x'] = anvil.accounts;
    publisher = first;
    verifier = second;
    const dep = await deployLocal(anvil);
    ctx = await openNetwork({ network: 'local', deploymentsDir: dep.dir });
    const signer = new UnlockedSigner(anvil.rpcUrl);
    const vault = await Vault.create(
      join(mkdtempSync(join(tmpdir(), 'poc-web-')), 'vault.json'),
      'correct horse battery staple',
      { N: 2 ** 14, r: 8, p: 1 },
    );
    const io = testIo({ confirm: true });
    const opts = {
      horizon: BigInt(4 * H),
      from: publisher,
      labelPrefix: 'RC',
      revealWindow: BigInt(24 * H),
      yes: true,
      direction: UP,
    } as const;

    overdue = await seal(ctx, signer, vault, { ...opts, asset: 'ETH' }, io);
    await anvil.warp(34 * H + 60); // past its reveal deadline: target + maxGap + 24 h
    revealable = await seal(ctx, signer, vault, { ...opts, asset: 'BTC' }, io);
    await mockPush(ctx, signer, { asset: 'BTC', answer: parsePrice('65000'), from: admin, yes: true }, io);
    await anvil.warp(4 * H + 1);
    await mockPush(ctx, signer, { asset: 'BTC', answer: parsePrice('66000'), from: admin, yes: true }, io);

    const outDir = mkdtempSync(join(tmpdir(), 'poc-web-dist-'));
    process.env.POC_LOCAL_DEPLOYMENT = join(dep.dir, 'local-31337.json');
    await build({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true },
    });
    delete process.env.POC_LOCAL_DEPLOYMENT;
    ({ server, url: appUrl } = await serve(outDir));
    browser = await chromium.launch(launchOptions());
  });

  afterAll(async () => {
    await browser.close();
    server.close();
    anvil.stop();
  });

  it('shows the network overview read from the chain', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    await page.goto(`${appUrl}#/net/31337`);
    await page.getByText('Proof of Call on Local anvil').waitFor();
    await page.locator('.stat', { hasText: 'Sealed calls' }).locator('.stat-value', { hasText: '2' }).waitFor();
    await page.getByText('Everything here is public on the QIE blockchain.').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'network.png'), fullPage: true });
    await page.close();
  });

  it('lets a verifier reveal a call from the shared link, then shows the outcome', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await injectWallet(page, anvil, verifier);
    const opening = {
      chainId: 31337,
      contract: ctx.contract,
      publisher,
      callId: revealable.callId,
      feed: revealable.feed,
      direction: revealable.direction,
      salt: revealable.salt,
    };
    await page.goto(`${appUrl}${shareFragment(opening)}`);
    await page.getByText(/The opening matches the sealed commitment: BTC UP/).waitFor();
    await page.getByRole('button', { name: 'Connect wallet' }).click();
    await page.getByRole('button', { name: 'Browser wallet' }).click();
    if (shots) await page.screenshot({ path: join(shots, 'reveal.png'), fullPage: true });
    await page.getByRole('button', { name: 'Reveal (public)' }).click();
    // After the receipt the page reloads the chain data and replaces the reveal panel with the result.
    await page.locator('.facts', { hasText: 'Outcome' }).getByText('HIT', { exact: true }).waitFor({ timeout: 30_000 });
    await page.getByText('verifier', { exact: true }).waitFor();
    await page.locator('.checks li.ok', { hasText: 'Commitment' }).waitFor({ timeout: 30_000 });
    await page.locator('.checks li.ok', { hasText: 'Entry round' }).waitFor();
    await page.locator('.checks li.ok', { hasText: 'Exit round' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'revealed.png'), fullPage: true });
    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
    await page.close();
  });

  it('lets anyone expire an overdue call, and the scorecard and verifiers follow', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 });
    await injectWallet(page, anvil, verifier);
    await page.goto(`${appUrl}#/call/31337/${publisher}/${overdue.callId}`);
    await page.getByText('Not revealed in time').first().waitFor();
    await page.getByRole('button', { name: 'Connect wallet' }).click();
    await page.getByRole('button', { name: 'Browser wallet' }).click();
    await page.getByRole('button', { name: 'Expire (counts as a miss)' }).click();
    await page.getByRole('heading', { name: 'Expired', exact: true }).waitFor({ timeout: 30_000 });
    await page.goto(`${appUrl}#/publisher/31337/${publisher}`);
    await page
      .getByText("Matches the contract's own scorecard() for this address.", { exact: false })
      .waitFor({ timeout: 30_000 });
    await page.getByText('Verifier wallets (1)').waitFor();
    await page.getByText(/1 reveal, 1 expiry/).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'publisher-mobile.png'), fullPage: true });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390); // no horizontal page scroll on a phone
    await page.close();
  });
});
