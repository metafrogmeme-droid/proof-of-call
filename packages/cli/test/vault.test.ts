import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { labelToCallId, randomSalt, UP } from '@proof-of-call/core';
import { describe, expect, it } from 'vitest';
import { Vault, type VaultEntry } from '../src/vault.js';

const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASSWORD = 'correct horse battery staple';

function entry(label: string, over: Partial<VaultEntry> = {}): VaultEntry {
  return {
    chainId: 1983,
    contract: '0xb6567DB95934ec74fabe4823D0c07125bfc29C54',
    publisher: '0x020A4366595292aa16184536bAB2E9949d0D925F',
    callId: labelToCallId(label),
    label,
    asset: 'BTC',
    feed: '0xa1141220424Fc103d1631BAd44039CEc0C4B6D28',
    direction: UP,
    salt: randomSalt(),
    horizon: '14400',
    revealBy: '1800100000',
    createdAt: new Date().toISOString(),
    state: 'prepared',
    ...over,
  };
}

const tmp = () => join(mkdtempSync(join(tmpdir(), 'poc-vault-')), 'vault.json');

describe('Vault', () => {
  it('stores entries encrypted and reopens them with the password', async () => {
    const path = tmp();
    const vault = await Vault.create(path, PASSWORD, FAST);
    const e = entry('RC-0001');
    vault.put(e);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(e.salt.slice(2));
    expect(text).not.toContain('RC-0001');
    expect(text).not.toContain('BTC');
    const reopened = await Vault.open(path, PASSWORD);
    expect(reopened.entries).toEqual([e]);
    expect(reopened.find(e.chainId, e.contract, e.publisher, e.callId)?.salt).toBe(e.salt);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('replaces an entry with the same key and keeps a backup of the previous file', async () => {
    const path = tmp();
    const vault = await Vault.create(path, PASSWORD, FAST);
    const e = entry('RC-0001');
    vault.put(e);
    vault.put({ ...e, state: 'sealed', sealTx: `0x${'ab'.repeat(32)}`, sealedAt: '1800000000' });
    expect(vault.entries).toHaveLength(1);
    expect(vault.entries[0]?.state).toBe('sealed');
    expect(existsSync(`${path}.bak`)).toBe(true);
    expect((await Vault.open(`${path}.bak`, PASSWORD)).entries[0]?.state).toBe('prepared');
  });

  it('rejects a wrong password and any tampering', async () => {
    const path = tmp();
    (await Vault.create(path, PASSWORD, FAST)).put(entry('RC-0001'));
    await expect(Vault.open(path, 'wrong password!!')).rejects.toThrow(/wrong vault password/);

    const file = JSON.parse(readFileSync(path, 'utf8')) as { data: string; kdf: { N: number } };
    const flipped = Buffer.from(file.data, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    writeFileSync(path, JSON.stringify({ ...file, data: flipped.toString('base64') }));
    await expect(Vault.open(path, PASSWORD)).rejects.toThrow(/damaged/);

    const fresh = tmp();
    (await Vault.create(fresh, PASSWORD, FAST)).put(entry('RC-0002'));
    const header = JSON.parse(readFileSync(fresh, 'utf8')) as { kdf: { N: number } };
    header.kdf.N = 2 ** 15; // header is authenticated: changing the KDF breaks decryption
    writeFileSync(fresh, JSON.stringify(header));
    await expect(Vault.open(fresh, PASSWORD)).rejects.toThrow();
  });

  it('refuses short passwords, an existing file, garbage and malformed entries', async () => {
    const path = tmp();
    await expect(Vault.create(path, 'short', FAST)).rejects.toThrow(/at least 12/);
    await Vault.create(path, PASSWORD, FAST);
    await expect(Vault.create(path, PASSWORD, FAST)).rejects.toThrow(/already exists/);
    const vault = await Vault.open(path, PASSWORD);
    expect(() => {
      vault.put({ ...entry('RC-0003'), salt: '0x12' });
    }).toThrow(/salt/);
    expect(vault.entries).toHaveLength(0);
    writeFileSync(path, 'not json');
    await expect(Vault.open(path, PASSWORD)).rejects.toThrow(/not valid JSON/);
    await expect(Vault.open(join(tmpdir(), 'does-not-exist.json'), PASSWORD)).rejects.toThrow(/no vault/);
  });

  it('refuses to write while another command holds the lock', async () => {
    const path = tmp();
    const vault = await Vault.create(path, PASSWORD, FAST);
    writeFileSync(`${path}.lock`, '');
    expect(() => {
      vault.put(entry('RC-0004'));
    }).toThrow(/in use/);
    expect(vault.entries).toHaveLength(0);
  });
});
