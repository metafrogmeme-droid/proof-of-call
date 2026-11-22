import { explorerUrl } from '@proof-of-call/core';
import { getAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import type { Ctx } from './context.js';
import type { Io } from './io.js';
import type { Signer, TxRequest } from './signers/index.js';

/**
 * Sends through the signer, waits for the receipt and checks that the mined transaction is exactly the prepared
 * one (sender, contract, calldata) and succeeded.
 */
export async function sendAndConfirm(ctx: Ctx, signer: Signer, tx: TxRequest, io: Io): Promise<TransactionReceipt> {
  io.out(`signing with ${signer.description}...`);
  const hash = await signer.send(tx);
  const link = explorerUrl(ctx.network, 'tx', hash);
  io.out(`sent ${hash}${link ? `\n  ${link}` : ''}`);
  const receipt = await ctx.client.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 });
  const mined = await ctx.client.getTransaction({ hash });
  if (getAddress(mined.from) !== getAddress(tx.from))
    throw new Error(`transaction ${hash} was sent from ${mined.from}, not ${tx.from}`);
  if (!mined.to || getAddress(mined.to) !== getAddress(tx.to))
    throw new Error(`transaction ${hash} went to ${mined.to ?? 'nothing'}, not ${tx.to}`);
  if (mined.input.toLowerCase() !== tx.data.toLowerCase())
    throw new Error(`transaction ${hash} carries other data than prepared`);
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

export function shortAddress(a: Address): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export function isHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
