import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

/**
 * URLs that occur as plain strings in the bundled libraries (error-message links, XML namespaces, viem's unused ENS
 * helpers). They are never requested: the CSP below only allows connections to the QIE RPCs. Any new host fails this
 * test so that it gets looked at.
 */
const INERT_HOSTS = new Set([
  'www.w3.org', // SVG/XML namespaces
  'react.dev', // React error decoder links
  'viem.sh',
  'oxlib.sh',
  'abitype.dev',
  'docs.soliditylang.org', // documentation links in viem error messages
  '4byte.sourcify.dev', // viem signature lookup helper, not used
  'ipfs.io',
  'arweave.net', // viem ENS avatar gateways, not used
]);
const QIE_HOST = /^(rpc\d(test|main)net|testnet|mainnet|docs)\.qie\.digital$/;

describe('production build (apps/web/dist)', () => {
  it('exists (run npm run build first)', () => {
    expect(existsSync(`${dist}index.html`)).toBe(true);
  });

  const html = existsSync(`${dist}index.html`) ? readFileSync(`${dist}index.html`, 'utf8') : '';
  const js = existsSync(`${dist}assets`)
    ? readdirSync(`${dist}assets`)
        .filter((f) => f.endsWith('.js'))
        .map((f) => readFileSync(`${dist}assets/${f}`, 'utf8'))
        .join('\n')
    : '';

  it('has a strict CSP that only allows connections to the QIE RPCs', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe');
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1]?.split(' ') ?? [];
    expect(connect.length).toBeGreaterThan(0);
    for (const origin of connect)
      expect(new URL(origin).protocol === 'https:' && QIE_HOST.test(new URL(origin).hostname)).toBe(true);
  });

  it('loads nothing from other hosts and contains no local test network', () => {
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(`${html}${js}`).not.toMatch(/127\.0\.0\.1|localhost:\d/);
    const hosts = new Set([...js.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)].map((m) => m[1] ?? ''));
    const unexpected = [...hosts].filter((h) => !INERT_HOSTS.has(h) && !QIE_HOST.test(h));
    expect(unexpected).toEqual([]);
  });
});
