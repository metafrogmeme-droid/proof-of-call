import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, UsageError, vaultPath } from '../src/main.js';
import { testIo } from './helpers/io.js';

describe('poc command line', () => {
  it('prints help', async () => {
    const io = testIo();
    await run(['--help'], io);
    expect(io.lines.join('\n')).toContain('Usage: poc <command>');
    await run([], io);
  });

  it('reports usage errors before touching the network', async () => {
    await expect(run(['seal'], testIo())).rejects.toThrow(UsageError);
    await expect(run(['seal', '--network', 'goerli'], testIo())).rejects.toThrow(/testnet, mainnet or local/);
    await expect(run(['seal', '--network', 'mainnet', '--yes'], testIo())).rejects.toThrow(/not allowed on mainnet/);
    await expect(run(['seal', '--nope'], testIo())).rejects.toThrow(/Unknown option/);
  });

  it('keeps the vault outside the repository', () => {
    expect(vaultPath(undefined)).toBe(join(homedir(), '.proof-of-call', 'vault.json'));
    expect(() => vaultPath('deployments/vault.json')).toThrow(/outside the repository/);
    expect(vaultPath('salts/vault.json')).toMatch(/salts[\\/]vault\.json$/);
  });
});
