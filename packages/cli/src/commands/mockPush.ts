import { feedFor, formatPrice, mockAggregatorV3Abi, type Asset } from '@proof-of-call/core';
import { encodeFunctionData, getAddress, type Address } from 'viem';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import type { Signer } from '../signers/index.js';
import { sendAndConfirm } from '../tx.js';

/**
 * Testnet and local only: pushes a price round to our MockAggregatorV3 (QIE testnet has no oracle). Signed by the
 * mock's admin (the testnet deployer). Real QIE Oracle feeds on mainnet cannot be written by anyone here.
 */
export async function mockPush(
  ctx: Ctx,
  signer: Signer,
  o: { asset: Asset; answer: bigint; from: Address; yes: boolean },
  io: Io,
): Promise<bigint> {
  if (ctx.network.key === 'mainnet') throw new Error('mock-push is for the testnet/local mock feeds only');
  const feed = feedFor(ctx.network, o.asset);
  if (feed.kind !== 'mock') throw new Error(`${feed.pair} is not a mock feed`);
  const admin = await ctx.client.readContract({
    address: feed.address,
    abi: mockAggregatorV3Abi,
    functionName: 'admin',
  });
  if (getAddress(admin) !== getAddress(o.from)) throw new Error(`only the mock admin ${admin} can push rounds`);
  if (o.answer <= 0n) throw new Error('price must be positive');
  const updatedAt = await chainNow(ctx);
  io.out(`push ${feed.pair} = ${formatPrice(o.answer, feed.decimals)} at ${updatedAt} to ${feed.address}`);
  if (!o.yes && !(await io.confirm('Push this round?'))) throw new Error('not confirmed; nothing sent');
  await sendAndConfirm(
    ctx,
    signer,
    {
      chainId: ctx.network.chainId,
      from: getAddress(o.from),
      to: feed.address,
      data: encodeFunctionData({ abi: mockAggregatorV3Abi, functionName: 'pushRound', args: [o.answer, updatedAt] }),
      title: `Push a mock ${feed.pair} round (${ctx.network.name})`,
      details: [`Price ${formatPrice(o.answer, feed.decimals)}`],
    },
    io,
  );
  const latest = await ctx.client.readContract({
    address: feed.address,
    abi: mockAggregatorV3Abi,
    functionName: 'latestRound',
  });
  io.out(`round ${latest} pushed`);
  return latest;
}
