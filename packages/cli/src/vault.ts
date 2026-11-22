import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  ASSETS,
  OUTCOMES,
  requireAddress,
  requireBytes32,
  requireInteger,
  requireRecord,
  requireString,
  type Asset,
  type Direction,
  type OutcomeName,
} from '@proof-of-call/core';
import type { Address, Hex } from 'viem';

/**
 * The publisher's local, password-encrypted store of call openings (the salts).
 *
 * A salt is the only thing that keeps a sealed call's asset and direction hidden, and without it the call can never
 * be revealed (it then expires as a MISS). So: the salt is written here before the seal transaction is sent, the file
 * is encrypted (scrypt + AES-256-GCM), replaced atomically with a .bak copy of the previous version, and never logged.
 */
export interface VaultEntry {
  chainId: number;
  contract: Address;
  publisher: Address;
  callId: Hex;
  label: string;
  asset: Asset;
  feed: Address;
  direction: Direction;
  salt: Hex;
  /** seconds, decimal string */
  horizon: string;
  /** unix seconds, decimal string */
  revealBy: string;
  createdAt: string;
  state: 'prepared' | 'sealed' | 'revealed' | 'expired';
  sealTx?: Hex;
  sealedAt?: string;
  revealTx?: Hex;
  outcome?: OutcomeName;
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~0.5 s and 128 MiB per unlock on a laptop. */
export const DEFAULT_KDF: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };
export const MIN_PASSWORD_LENGTH = 12;
const FORMAT = 'proof-of-call-vault';
const LOCK_STALE_MS = 10 * 60_000;

interface Header {
  format: typeof FORMAT;
  version: 1;
  kdf: { name: 'scrypt'; salt: string } & ScryptParams;
}

interface VaultFile extends Header {
  cipher: { name: 'aes-256-gcm'; iv: string; tag: string };
  data: string;
}

function scrypt(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r + 32 * 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, 32, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function sameKey(a: VaultEntry, chainId: number, contract: Address, publisher: Address, callId: Hex): boolean {
  return (
    a.chainId === chainId &&
    a.contract.toLowerCase() === contract.toLowerCase() &&
    a.publisher.toLowerCase() === publisher.toLowerCase() &&
    a.callId.toLowerCase() === callId.toLowerCase()
  );
}

export class Vault {
  private constructor(
    readonly path: string,
    private readonly key: Buffer,
    private readonly header: Header,
    private items: VaultEntry[],
  ) {}

  static exists(path: string): boolean {
    return existsSync(path);
  }

  static async create(path: string, password: string, kdf: ScryptParams = DEFAULT_KDF): Promise<Vault> {
    if (existsSync(path)) throw new Error(`a vault already exists at ${path}`);
    if (password.length < MIN_PASSWORD_LENGTH)
      throw new Error(`vault password: at least ${MIN_PASSWORD_LENGTH} characters`);
    const header: Header = {
      format: FORMAT,
      version: 1,
      kdf: { name: 'scrypt', salt: randomBytes(16).toString('base64'), ...kdf },
    };
    const key = await scrypt(password, Buffer.from(header.kdf.salt, 'base64'), kdf);
    const vault = new Vault(path, key, header, []);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    vault.write();
    return vault;
  }

  static async open(path: string, password: string): Promise<Vault> {
    if (!existsSync(path)) throw new Error(`no vault at ${path}`);
    const file = parseFile(readFileSync(path, 'utf8'));
    const header: Header = { format: file.format, version: file.version, kdf: file.kdf };
    const key = await scrypt(password, Buffer.from(file.kdf.salt, 'base64'), file.kdf);
    let plain: string;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.cipher.iv, 'base64'));
      decipher.setAAD(Buffer.from(JSON.stringify(header)));
      decipher.setAuthTag(Buffer.from(file.cipher.tag, 'base64'));
      plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8');
    } catch (err) {
      throw new Error(
        'wrong vault password, or the vault file is damaged (a .bak copy of the previous version may exist)',
        {
          cause: err,
        },
      );
    }
    const parsed = requireRecord(JSON.parse(plain), 'vault');
    if (!Array.isArray(parsed.entries)) throw new Error('vault: entries missing');
    return new Vault(
      path,
      key,
      header,
      parsed.entries.map((e, i) => parseEntry(e, i)),
    );
  }

  get entries(): readonly VaultEntry[] {
    return this.items;
  }

  find(chainId: number, contract: Address, publisher: Address, callId: Hex): VaultEntry | undefined {
    return this.items.find((e) => sameKey(e, chainId, contract, publisher, callId));
  }

  /** Inserts or replaces the entry with the same chain, contract, publisher and call id, then saves. */
  put(entry: VaultEntry): void {
    const checked = parseEntry(entry, this.items.length);
    const i = this.items.findIndex((e) =>
      sameKey(e, checked.chainId, checked.contract, checked.publisher, checked.callId),
    );
    const next = [...this.items];
    if (i >= 0) next[i] = checked;
    else next.push(checked);
    const previous = this.items;
    this.items = next;
    try {
      this.write();
    } catch (err) {
      this.items = previous;
      throw err;
    }
  }

  private write(): void {
    const lock = `${this.path}.lock`;
    this.acquire(lock);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(JSON.stringify(this.header)));
      const data = Buffer.concat([cipher.update(JSON.stringify({ entries: this.items }), 'utf8'), cipher.final()]);
      const file: VaultFile = {
        ...this.header,
        cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
        data: data.toString('base64'),
      };
      const tmp = `${this.path}.tmp-${randomBytes(6).toString('hex')}`;
      const fd = openSync(tmp, 'wx', 0o600);
      try {
        writeSync(fd, `${JSON.stringify(file, null, 2)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (existsSync(this.path)) copyFileSync(this.path, `${this.path}.bak`);
      renameSync(tmp, this.path);
      try {
        chmodSync(this.path, 0o600);
      } catch {
        // Windows: permissions come from the user profile folder.
      }
    } finally {
      rmSync(lock, { force: true });
    }
  }

  private acquire(lock: string): void {
    try {
      closeSync(openSync(lock, 'wx', 0o600));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) {
        throw new Error(`the vault is in use by another poc command (${lock}); try again in a moment`, { cause: err });
      }
      rmSync(lock, { force: true });
      closeSync(openSync(lock, 'wx', 0o600));
    }
  }
}

function parseFile(text: string): VaultFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error('the vault file is not valid JSON (a .bak copy of the previous version may exist)', { cause: err });
  }
  const f = requireRecord(raw, 'vault file');
  if (f.format !== FORMAT || f.version !== 1) throw new Error('not a Proof of Call vault file');
  const kdf = requireRecord(f.kdf, 'vault kdf');
  const cipher = requireRecord(f.cipher, 'vault cipher');
  if (kdf.name !== 'scrypt' || cipher.name !== 'aes-256-gcm') throw new Error('unsupported vault algorithms');
  const N = requireInteger(kdf.N, 'kdf.N');
  const r = requireInteger(kdf.r, 'kdf.r');
  const p = requireInteger(kdf.p, 'kdf.p');
  if (N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16)
    throw new Error('vault kdf parameters out of range');
  return {
    format: FORMAT,
    version: 1,
    kdf: { name: 'scrypt', salt: requireString(kdf.salt, 'kdf.salt'), N, r, p },
    cipher: {
      name: 'aes-256-gcm',
      iv: requireString(cipher.iv, 'cipher.iv'),
      tag: requireString(cipher.tag, 'cipher.tag'),
    },
    data: requireString(f.data, 'data'),
  };
}

const STATES: readonly VaultEntry['state'][] = ['prepared', 'sealed', 'revealed', 'expired'];

function parseEntry(value: unknown, i: number): VaultEntry {
  const e = requireRecord(value, `vault entry ${i}`);
  const asset = ASSETS.find((a) => a === e.asset);
  const state = STATES.find((s) => s === e.state);
  const outcome = OUTCOMES.find((o) => o === e.outcome);
  if (!asset || !state || (e.direction !== 1 && e.direction !== 2))
    throw new Error(`vault entry ${i}: invalid asset, state or direction`);
  const decimal = (v: unknown, field: string) => {
    const s = requireString(v, field);
    if (!/^\d+$/.test(s)) throw new Error(`${field}: expected a decimal integer`);
    return s;
  };
  const entry: VaultEntry = {
    chainId: requireInteger(e.chainId, `vault entry ${i}.chainId`),
    contract: requireAddress(e.contract, `vault entry ${i}.contract`),
    publisher: requireAddress(e.publisher, `vault entry ${i}.publisher`),
    callId: requireBytes32(e.callId, `vault entry ${i}.callId`),
    label: requireString(e.label, `vault entry ${i}.label`),
    asset,
    feed: requireAddress(e.feed, `vault entry ${i}.feed`),
    direction: e.direction,
    salt: requireBytes32(e.salt, `vault entry ${i}.salt`),
    horizon: decimal(e.horizon, `vault entry ${i}.horizon`),
    revealBy: decimal(e.revealBy, `vault entry ${i}.revealBy`),
    createdAt: requireString(e.createdAt, `vault entry ${i}.createdAt`),
    state,
  };
  if (e.sealTx !== undefined) entry.sealTx = requireBytes32(e.sealTx, `vault entry ${i}.sealTx`);
  if (e.sealedAt !== undefined) entry.sealedAt = decimal(e.sealedAt, `vault entry ${i}.sealedAt`);
  if (e.revealTx !== undefined) entry.revealTx = requireBytes32(e.revealTx, `vault entry ${i}.revealTx`);
  if (outcome) entry.outcome = outcome;
  return entry;
}
