import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Hex } from 'viem';
import { bridgePage, type AddChainParams } from './bridgePage.js';
import type { Signer, TxRequest } from './types.js';

export interface BrowserSignerOptions {
  chain: AddChainParams;
  /** Called with the one-time URL; the CLI prints it (and may open it). */
  onUrl: (url: string) => void;
  timeoutMs?: number;
}

const MAX_BODY = 4096;

function equalTokens(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function securityHeaders(res: ServerResponse, nonce?: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce ?? 'none'}'; style-src 'nonce-${nonce ?? 'none'}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
}

function reply(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

/**
 * Signs with a browser wallet (MetaMask, QIE Wallet extension, ...): serves a one-shot page on 127.0.0.1 under a
 * random 256-bit path, checks Host and Origin (no DNS rebinding, no cross-site posts), accepts exactly one answer,
 * then shuts down.
 */
export class BrowserSigner implements Signer {
  readonly description = 'browser wallet (one-shot page on 127.0.0.1)';

  constructor(private readonly opts: BrowserSignerOptions) {}

  send(tx: TxRequest): Promise<Hex> {
    const token = randomBytes(32).toString('hex');
    const timeoutMs = this.opts.timeoutMs ?? 10 * 60_000;
    return new Promise<Hex>((resolve, reject) => {
      let settled = false;
      let origin = '';
      const server = createServer((req, res) => {
        handle(req, res);
      });
      const finish = (error: Error | null, hash?: Hex) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        if (error) reject(error);
        else if (hash) resolve(hash);
      };
      const timer = setTimeout(() => {
        finish(
          new Error(
            `no answer from the browser within ${Math.round(timeoutMs / 60_000)} min. If you confirmed in the wallet, check its activity before retrying.`,
          ),
        );
      }, timeoutMs);

      const handle = (req: IncomingMessage, res: ServerResponse): void => {
        if (req.headers.host !== origin.slice('http://'.length)) {
          reply(res, 421, 'wrong host');
          return;
        }
        const url = new URL(req.url ?? '/', origin);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length === 0 || !equalTokens(parts[0] ?? '', token)) {
          reply(res, 404, 'not found');
          return;
        }
        if (req.method === 'GET' && parts.length === 1) {
          const nonce = randomBytes(16).toString('base64');
          securityHeaders(res, nonce);
          reply(res, 200, bridgePage(tx, this.opts.chain, nonce), 'text/html; charset=utf-8');
          return;
        }
        if (req.method !== 'POST' || parts.length !== 2 || parts[1] !== 'result') {
          reply(res, 405, 'not allowed');
          return;
        }
        securityHeaders(res);
        if (req.headers.origin !== origin) {
          reply(res, 403, 'wrong origin');
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          reply(res, 415, 'json only');
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            reply(res, 400, 'bad json');
            return;
          }
          const msg = parsed as { hash?: unknown; error?: unknown };
          if (typeof msg.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(msg.hash)) {
            reply(res, 200, '{"ok":true}', 'application/json');
            finish(null, msg.hash.toLowerCase() as Hex);
          } else if (typeof msg.error === 'string') {
            reply(res, 200, '{"ok":true}', 'application/json');
            finish(new Error(`browser wallet: ${msg.error.slice(0, 200)}; nothing sent`));
          } else {
            reply(res, 400, 'expected {hash} or {error}');
          }
        });
      };

      server.on('error', (err) => {
        finish(err);
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        origin = `http://127.0.0.1:${port}`;
        this.opts.onUrl(`${origin}/${token}`);
      });
    });
  }
}
