import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { BrowserSigner } from '../src/signers/browser.js';
import type { TxRequest } from '../src/signers/types.js';

const TX: TxRequest = {
  chainId: 1983,
  from: '0x020A4366595292aa16184536bAB2E9949d0D925F',
  to: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
  data: '0xdeadbeef',
  title: 'Seal call RC-0001 <script>alert(1)</script>',
  details: ['Horizon 4h'],
};
const CHAIN = {
  chainId: '0x7bf',
  chainName: 'QIE Testnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: ['https://rpc2testnet.qie.digital/'],
};

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function http(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

function start(timeoutMs = 10_000) {
  let resolveUrl: (u: string) => void = () => undefined;
  const url = new Promise<string>((r) => (resolveUrl = r));
  const signer = new BrowserSigner({
    chain: CHAIN,
    onUrl: (u) => {
      resolveUrl(u);
    },
    timeoutMs,
  });
  const result = signer.send(TX);
  result.catch(() => undefined);
  return { url, result };
}

describe('BrowserSigner', () => {
  it('serves the page only under the token, with a strict CSP and escaped content', async () => {
    const { url, result } = start();
    const u = new URL(await url);
    expect(u.hostname).toBe('127.0.0.1');
    expect(u.pathname).toMatch(/^\/[0-9a-f]{64}$/);
    const page = await http(u.href);
    expect(page.status).toBe(200);
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&#60;script&#62;');
    expect(page.body).toContain(TX.data);
    expect((await http(`${u.origin}/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await http(`${u.origin}/`)).status).toBe(404);
    await http(`${u.href}/result`, {
      method: 'POST',
      headers: { origin: u.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'test over' }),
    });
    await expect(result).rejects.toThrow(/test over/);
  });

  it('refuses other hosts (DNS rebinding), cross-origin posts and non-JSON bodies', async () => {
    const { url, result } = start();
    const u = new URL(await url);
    expect((await http(u.href, { headers: { host: `evil.example:${u.port}` } })).status).toBe(421);
    expect(
      (await http(`${u.href}/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
        .status,
    ).toBe(403);
    expect(
      (
        await http(`${u.href}/result`, {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await http(`${u.href}/result`, {
          method: 'POST',
          headers: { origin: u.origin, 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await http(`${u.href}/result`, {
          method: 'POST',
          headers: { origin: u.origin, 'content-type': 'application/json' },
          body: '{"hash":"0x12"}',
        })
      ).status,
    ).toBe(400);
    const ok = await http(`${u.href}/result`, {
      method: 'POST',
      headers: { origin: u.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ hash: `0x${'CD'.repeat(32)}` }),
    });
    expect(ok.status).toBe(200);
    await expect(result).resolves.toBe(`0x${'cd'.repeat(32)}`);
    await expect(http(u.href)).rejects.toThrow(); // one answer only: the server is gone
  });

  it('gives up after the timeout', async () => {
    const { url, result } = start(200);
    await url;
    await expect(result).rejects.toThrow(/no answer from the browser/);
  });
});
