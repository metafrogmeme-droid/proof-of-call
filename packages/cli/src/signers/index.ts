import { toHex } from 'viem';
import type { Ctx } from '../context.js';
import { BrowserSigner } from './browser.js';
import type { AddChainParams } from './bridgePage.js';
import { CastSigner } from './cast.js';
import type { Signer } from './types.js';
import { UnlockedSigner } from './unlocked.js';

export type { Signer, TxRequest } from './types.js';

/** EIP-3085 parameters so the wallet can add the QIE network if it does not know it yet. */
export function addChainParams(ctx: Ctx): AddChainParams {
  return {
    chainId: toHex(ctx.network.chainId),
    chainName: ctx.network.name,
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: [...ctx.network.rpcUrls],
    ...(ctx.network.explorer ? { blockExplorerUrls: [ctx.network.explorer] } : {}),
  };
}

/** --signer browser | account:<keystore name> | ledger | unlocked */
export function makeSigner(spec: string, ctx: Ctx, onUrl: (url: string) => void): Signer {
  if (spec === 'browser') return new BrowserSigner({ chain: addChainParams(ctx), onUrl });
  if (spec === 'ledger') return new CastSigner({ kind: 'ledger' }, ctx.rpcUrl);
  if (spec.startsWith('account:'))
    return new CastSigner({ kind: 'account', name: spec.slice('account:'.length) }, ctx.rpcUrl);
  if (spec === 'unlocked') {
    if (ctx.network.key !== 'local') throw new Error('--signer unlocked is only for the local anvil network');
    return new UnlockedSigner(ctx.rpcUrl);
  }
  throw new Error(`unknown --signer "${spec}" (browser, account:<keystore name>, ledger)`);
}
