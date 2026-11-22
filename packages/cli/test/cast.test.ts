import type { StdioOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CastSigner, type Runner } from '../src/signers/cast.js';
import type { TxRequest } from '../src/signers/types.js';

const TX: TxRequest = {
  chainId: 1983,
  from: '0x020A4366595292aa16184536bAB2E9949d0D925F',
  to: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
  data: '0xdeadbeef',
  title: 't',
  details: [],
};

function fakeCast(address: string, sendOut = `0x${'ab'.repeat(32)}\n`) {
  const calls: { args: readonly string[]; stdio: StdioOptions }[] = [];
  const run: Runner = (_cmd, args, stdio) => {
    calls.push({ args, stdio });
    return Promise.resolve(args[0] === 'wallet' ? `${address}\n` : sendOut);
  };
  return { run, calls };
}

describe('CastSigner', () => {
  it('checks the keystore address, then sends the exact calldata asynchronously', async () => {
    const { run, calls } = fakeCast('0x020a4366595292aa16184536bab2e9949d0d925f');
    const hash = await new CastSigner({ kind: 'account', name: 'qie-publisher' }, 'https://rpc.example/', run).send(TX);
    expect(hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      'wallet address --account qie-publisher',
      `send ${TX.to} --data 0xdeadbeef --rpc-url https://rpc.example/ --async --account qie-publisher`,
    ]);
    // stdin and stderr stay attached to the terminal for cast's own password prompt
    expect(calls[1]?.stdio).toEqual(['inherit', 'pipe', 'inherit']);
  });

  it('uses the Ledger', async () => {
    const { run, calls } = fakeCast(TX.from);
    await new CastSigner({ kind: 'ledger' }, 'https://rpc.example/', run).send(TX);
    expect(calls[0]?.args).toEqual(['wallet', 'address', '--ledger']);
    expect(calls[1]?.args.at(-1)).toBe('--ledger');
  });

  it('sends nothing when the wallet is another address', async () => {
    const { run, calls } = fakeCast('0x0000000000000000000000000000000000000001');
    await expect(new CastSigner({ kind: 'account', name: 'x' }, 'https://rpc.example/', run).send(TX)).rejects.toThrow(
      /nothing sent/,
    );
    expect(calls).toHaveLength(1);
  });

  it('rejects odd account names and output without a hash', async () => {
    expect(() => new CastSigner({ kind: 'account', name: 'a b; rm -rf' }, 'https://rpc.example/')).toThrow(
      /account name/,
    );
    const { run } = fakeCast(TX.from, 'something else');
    await expect(new CastSigner({ kind: 'ledger' }, 'https://rpc.example/', run).send(TX)).rejects.toThrow(/hash/);
  });
});
