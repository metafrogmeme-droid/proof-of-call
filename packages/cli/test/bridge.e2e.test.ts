import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UP } from '@proof-of-call/core';
import { chromium, type Browser, type LaunchOptions, type Page } from 'playwright';
import type { Address } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seal, type SealOptions } from '../src/commands/seal.js';
import { openNetwork, type Ctx } from '../src/context.js';
import { BrowserSigner } from '../src/signers/browser.js';
import { addChainParams } from '../src/signers/index.js';
import { Vault } from '../src/vault.js';
import { deployLocal, startAnvil, type Anvil } from './helpers/anvil.js';
import { testIo } from './helpers/io.js';

/** Local runs point POC_CHROMIUM_PATH at a Chromium binary; GitHub's Ubuntu runners ship Google Chrome. */
function launchOptions(): LaunchOptions {
  const path = process.env.POC_CHROMIUM_PATH;
  return path ? { executablePath: path } : { channel: 'chrome' };
}

interface WalletState {
  account: Address;
  chainId: string;
  calls: string[];
}

/** An EIP-1193 wallet inside the page whose requests are answered in Node: signing goes to anvil's unlocked account. */
async function injectWallet(page: Page, anvil: Anvil, state: WalletState): Promise<void> {
  await page.exposeFunction('__pocWallet', async (method: string, params: unknown[]) => {
    state.calls.push(method);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [state.account];
    if (method === 'eth_chainId') return state.chainId;
    if (method === 'wallet_switchEthereumChain') {
      state.chainId = (params[0] as { chainId: string }).chainId;
      return null;
    }
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
    const w = window as unknown as {
      ethereum: unknown;
      __pocWallet: (method: string, params: unknown[]) => Promise<unknown>;
    };
    w.ethereum = {
      request: ({ method, params }: { method: string; params?: unknown[] }) => w.__pocWallet(method, params ?? []),
    };
  });
}

describe('browser signing page (Chromium, injected wallet, anvil)', () => {
  let anvil: Anvil;
  let ctx: Ctx;
  let vault: Vault;
  let browser: Browser;
  let publisher: Address;
  let other: Address;

  beforeAll(async () => {
    anvil = await startAnvil();
    [, publisher = '0x', other = '0x'] = anvil.accounts;
    const dep = await deployLocal(anvil);
    ctx = await openNetwork({ network: 'local', deploymentsDir: dep.dir });
    vault = await Vault.create(
      join(mkdtempSync(join(tmpdir(), 'poc-e2e-')), 'vault.json'),
      'correct horse battery staple',
      {
        N: 2 ** 14,
        r: 8,
        p: 1,
      },
    );
    browser = await chromium.launch(launchOptions());
  });

  afterAll(async () => {
    await browser.close();
    anvil.stop();
  });

  const opts = (): SealOptions => ({
    asset: 'BTC',
    direction: UP,
    horizon: 14_400n,
    from: publisher,
    labelPrefix: 'WEB',
    revealWindow: 86_400n,
    yes: true,
  });

  it('switches the wallet to the right chain and sends exactly the prepared seal', async () => {
    const page = await browser.newPage();
    const wallet: WalletState = { account: publisher, chainId: '0x1', calls: [] };
    await injectWallet(page, anvil, wallet);
    const signer = new BrowserSigner({
      chain: addChainParams(ctx),
      onUrl: (url) => {
        void page.goto(url).then(() => page.getByRole('button', { name: /Send with/ }).click());
      },
    });
    const entry = await seal(ctx, signer, vault, opts(), testIo({ confirm: true }));
    expect(entry.state).toBe('sealed');
    expect(wallet.calls).toEqual([
      'eth_requestAccounts',
      'eth_chainId',
      'wallet_switchEthereumChain',
      'eth_chainId',
      'eth_sendTransaction',
    ]);
    expect(wallet.chainId).toBe('0x7a69');
    await page.locator('#status', { hasText: 'Sent: 0x' }).waitFor({ timeout: 5000 });
    await page.close();
  });

  it('refuses to send from another account than the publisher', async () => {
    const page = await browser.newPage();
    const wallet: WalletState = { account: other, chainId: '0x7a69', calls: [] };
    await injectWallet(page, anvil, wallet);
    const signer = new BrowserSigner({
      chain: addChainParams(ctx),
      timeoutMs: 3000,
      onUrl: (url) => {
        void page.goto(url).then(() => page.getByRole('button', { name: /Send with/ }).click());
      },
    });
    await expect(seal(ctx, signer, vault, opts(), testIo({ confirm: true }))).rejects.toThrow(
      /no answer from the browser/,
    );
    await page.locator('#status', { hasText: `Select account ${publisher}` }).waitFor({ timeout: 5000 });
    expect(wallet.calls).not.toContain('eth_sendTransaction');
    await page.close();
  });
});
