import { spawn, type StdioOptions } from 'node:child_process';
import { getAddress, isAddress, type Hex } from 'viem';
import type { Signer, TxRequest } from './types.js';

export type CastWallet = { kind: 'account'; name: string } | { kind: 'ledger' };

export type Runner = (cmd: string, args: readonly string[], stdio: StdioOptions) => Promise<string>;

/** Runs a command with the terminal attached (password prompts), capturing only stdout. */
export const runAttached: Runner = (cmd, args, stdio) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio, shell: false });
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (out += chunk));
    child.on('error', (err) => {
      reject(new Error(`could not start ${cmd}: ${err.message} (is Foundry installed and on PATH?)`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args[0] ?? ''} ${args[1] ?? ''} failed with exit code ${code}`));
    });
  });

const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Signs with Foundry: a keystore account (`cast wallet import`, password prompted by cast) or a Ledger. The key and
 * the password stay inside cast; this code only sees the address and the transaction hash.
 */
export class CastSigner implements Signer {
  readonly description: string;

  constructor(
    private readonly wallet: CastWallet,
    private readonly rpcUrl: string,
    private readonly run: Runner = runAttached,
    private readonly cast = 'cast',
  ) {
    if (wallet.kind === 'account' && !ACCOUNT_NAME.test(wallet.name)) {
      throw new Error('keystore account name: letters, digits, . _ - only');
    }
    this.description = wallet.kind === 'account' ? `Foundry keystore "${wallet.name}"` : 'Ledger (via cast)';
  }

  private walletArgs(): string[] {
    return this.wallet.kind === 'account' ? ['--account', this.wallet.name] : ['--ledger'];
  }

  async send(tx: TxRequest): Promise<Hex> {
    // Check the signing address first: a seal from another address could never be opened by the publisher.
    const addressOut = (
      await this.run(this.cast, ['wallet', 'address', ...this.walletArgs()], ['inherit', 'pipe', 'inherit'])
    ).trim();
    const address = addressOut.split(/\s+/).pop() ?? '';
    if (!isAddress(address)) throw new Error('cast did not print the wallet address');
    if (getAddress(address) !== getAddress(tx.from)) {
      throw new Error(
        `the ${this.description} is ${getAddress(address)}, not --from ${getAddress(tx.from)}; nothing sent`,
      );
    }
    const out = await this.run(
      this.cast,
      ['send', tx.to, '--data', tx.data, '--rpc-url', this.rpcUrl, '--async', ...this.walletArgs()],
      ['inherit', 'pipe', 'inherit'],
    );
    const hash = /0x[0-9a-fA-F]{64}/.exec(out)?.[0];
    if (!hash) throw new Error('cast send did not print a transaction hash');
    return hash.toLowerCase() as Hex;
  }
}
