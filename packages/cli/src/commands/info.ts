import {
  contractFeedReader,
  explorerUrl,
  formatDuration,
  formatPrice,
  formatTimestamp,
  proofOfCallAbi,
} from '@proof-of-call/core';
import { chainNow, type Ctx } from '../context.js';
import type { Io } from '../io.js';
import { readDefaults } from '../reads.js';

/** Read-only overview of the network, the contract and its feeds. */
export async function info(ctx: Ctx, io: Io): Promise<void> {
  const { network } = ctx;
  const [now, defaults, owner] = await Promise.all([
    chainNow(ctx),
    readDefaults(ctx),
    ctx.client.readContract({ address: ctx.contract, abi: proofOfCallAbi, functionName: 'owner' }),
  ]);
  io.out(`network       ${network.name} (chain ${network.chainId}) via ${ctx.rpcUrl}`);
  io.out(
    `ProofOfCall   ${ctx.contract}${explorerUrl(network, 'address', ctx.contract) ? `  ${explorerUrl(network, 'address', ctx.contract) ?? ''}` : ''}`,
  );
  io.out(`owner         ${owner}`);
  io.out(`defaults      maxGap ${formatDuration(defaults.maxGap)}, flat band ${defaults.flatBandBps} bps`);
  io.out(`chain time    ${formatTimestamp(now)}`);
  for (const feed of network.feeds) {
    const allowed = await ctx.client.readContract({
      address: ctx.contract,
      abi: proofOfCallAbi,
      functionName: 'isFeedAllowedAt',
      args: [feed.address, now],
    });
    let price = 'no data yet';
    try {
      const latest = await contractFeedReader(ctx.client, feed.address).latest();
      price = `${formatPrice(latest.answer, feed.decimals)} (round ${latest.roundId}, ${formatDuration(now - latest.updatedAt)} ago)`;
    } catch {
      // empty mock feeds revert until the first round is pushed
    }
    io.out(`feed ${feed.asset.padEnd(8)} ${feed.address} ${feed.kind}${allowed ? '' : ' NOT ALLOWED'}  ${price}`);
  }
  if (!network.feedsVerified) io.out('warning: the feed addresses of this network are not verified yet');
}
