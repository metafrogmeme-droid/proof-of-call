import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPublicClient, http } from 'viem';
import { expect, it } from 'vitest';
import { openNetwork } from '../src/context.js';
import { info } from '../src/commands/info.js';
import { testIo } from './helpers/io.js';

const script = new URL('../../../scripts/local-chain.mjs', import.meta.url).pathname;

/** A port that is free right now (the script itself needs a fixed port, like the 8545 of the walkthrough). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** The README's local walkthrough: the demo chain script deploys a working local network and can move its time. */
it('scripts/local-chain.mjs starts a local network that the CLI can use, and warps time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'poc-local-'));
  const port = String(await freePort());
  const env = { ...process.env, LOCAL_CHAIN_PORT: port, DEPLOYMENTS_DIR: dir };
  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise<void>((resolve, reject) => {
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
        if (out.includes('Local chain ready')) resolve();
      });
      child.on('exit', (code) => {
        reject(new Error(`local-chain exited with ${code}`));
      });
    });
    const record = JSON.parse(readFileSync(join(dir, 'local-31337.json'), 'utf8')) as { chainId: number; rpc: string };
    expect(record).toMatchObject({ chainId: 31337, rpc: `http://127.0.0.1:${port}` });

    const io = testIo();
    await info(await openNetwork({ network: 'local', deploymentsDir: dir }), io);
    expect(io.lines.some((l) => l.startsWith('feed BTC'))).toBe(true);

    const client = createPublicClient({ transport: http(record.rpc) });
    const before = (await client.getBlock()).timestamp;
    await promisify(execFile)(process.execPath, [script, 'warp', '4h'], { env });
    expect((await client.getBlock()).timestamp - before).toBeGreaterThanOrEqual(14_400n);
  } finally {
    child.kill('SIGTERM');
  }
});
