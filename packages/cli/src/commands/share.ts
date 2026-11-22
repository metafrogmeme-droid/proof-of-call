import {
  formatTimestamp,
  openingToJson,
  parseCallRef,
  shareFragment,
  targetTime,
  type Opening,
} from '@proof-of-call/core';
import { existsSync, writeFileSync } from 'node:fs';
import { getAddress, type Address } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readCall } from '../reads.js';
import type { Vault } from '../vault.js';

/**
 * The opening of a call whose horizon has passed. Before that it would leak the call, so it is refused. After the
 * target, anyone holding the opening can reveal: the outcome is fixed by the oracle and credited to the publisher.
 */
async function openingAfterTarget(
  ctx: Ctx,
  vault: Vault,
  ref: string,
  publisher: Address,
): Promise<{ opening: Opening; label: string }> {
  const callId = parseCallRef(ref);
  const entry = vault.find(ctx.network.chainId, ctx.contract, getAddress(publisher), callId);
  if (!entry) throw new Error(`no opening for ${ref} in the vault`);
  const call = await readCall(ctx, entry.publisher, callId);
  if (call.sealedAt === 0n) throw new Error('the call is not sealed on chain');
  const target = targetTime(call);
  if ((await chainNow(ctx)) < target) {
    throw new Error(
      `refusing to share before the target (${formatTimestamp(target)}): the opening would reveal the call early`,
    );
  }
  return {
    opening: {
      chainId: entry.chainId,
      contract: entry.contract,
      publisher: entry.publisher,
      callId,
      feed: entry.feed,
      direction: entry.direction,
      salt: entry.salt,
    },
    label: entry.label,
  };
}

export async function share(
  ctx: Ctx,
  vault: Vault,
  o: { ref: string; publisher: Address; baseUrl: string },
  io: Io,
): Promise<string> {
  const base = new URL(o.baseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('--base-url must be https:// (or localhost for a local app)');
  }
  const { opening } = await openingAfterTarget(ctx, vault, o.ref, o.publisher);
  const url = `${base.origin}${base.pathname.replace(/\/$/, '')}/${shareFragment(opening)}`;
  io.out(url);
  io.out(
    'Anyone with this link can reveal the call (the result is credited to the publisher). The opening sits in the',
  );
  io.out('part after "#", which browsers never send to a server.');
  return url;
}

export async function exportOpening(
  ctx: Ctx,
  vault: Vault,
  o: { ref: string; publisher: Address; out?: string | undefined },
  io: Io,
): Promise<string> {
  const { opening, label } = await openingAfterTarget(ctx, vault, o.ref, o.publisher);
  const file = o.out ?? `opening-${label}.json`;
  if (existsSync(file)) throw new Error(`${file} exists; not overwriting`);
  writeFileSync(file, openingToJson(opening), { flag: 'wx' });
  io.out(`wrote ${file} (reveal with: poc reveal --opening ${file} ...)`);
  return file;
}
