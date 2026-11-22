import {
  callPhase,
  computeCommitment,
  directionName,
  formatTimestamp,
  outcomeName,
  targetTime,
} from '@proof-of-call/core';
import { getAddress } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readCall } from '../reads.js';
import type { Vault, VaultEntry } from '../vault.js';

export interface ListedCall {
  entry: VaultEntry;
  status: string;
}

/** The vault's calls on this network with their live on-chain status. Fixes up entries whose seal was mined later. */
export async function list(ctx: Ctx, vault: Vault, io: Io): Promise<ListedCall[]> {
  const now = await chainNow(ctx);
  const rows: ListedCall[] = [];
  const mine = vault.entries.filter(
    (e) => e.chainId === ctx.network.chainId && getAddress(e.contract) === getAddress(ctx.contract),
  );
  for (const entry of mine) {
    const call = await readCall(ctx, entry.publisher, entry.callId);
    const ours = call.sealedAt !== 0n && call.commitment === computeCommitment({ ...entry, chainId: entry.chainId });
    let status: string;
    if (!ours) {
      status =
        entry.state === 'prepared' ? 'not sealed (transaction never mined)' : 'MISMATCH: on-chain commitment differs';
    } else {
      const phase = callPhase(call, now);
      status =
        phase === 'settled'
          ? outcomeName(call.outcome)
          : phase === 'waiting'
            ? `waiting until ${formatTimestamp(targetTime(call))}`
            : phase === 'revealable'
              ? `REVEAL NOW (until ${formatTimestamp(call.revealBy)})`
              : 'expirable (counts as MISS)';
      if (entry.state === 'prepared') vault.put({ ...entry, state: 'sealed', sealedAt: call.sealedAt.toString() });
    }
    rows.push({ entry, status });
    io.out(
      `${entry.label.padEnd(12)} ${entry.asset} ${directionName(entry.direction).padEnd(4)} ${entry.publisher}  ${status}`,
    );
  }
  if (rows.length === 0) io.out(`no calls in the vault for ${ctx.network.name}`);
  return rows;
}
