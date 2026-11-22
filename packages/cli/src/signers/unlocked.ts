import { LOCAL_CHAIN_ID } from '@proof-of-call/core';
import { createWalletClient, http, type Hex } from 'viem';
import type { Signer, TxRequest } from './types.js';

/** anvil's unlocked dev accounts (eth_sendTransaction). Local chain 31337 only: tests and demos. */
export class UnlockedSigner implements Signer {
  readonly description = 'anvil unlocked account (local only)';

  constructor(private readonly rpcUrl: string) {}

  async send(tx: TxRequest): Promise<Hex> {
    if (tx.chainId !== LOCAL_CHAIN_ID)
      throw new Error('the unlocked signer only works on the local anvil chain (31337)');
    const wallet = createWalletClient({ transport: http(this.rpcUrl) });
    return wallet.sendTransaction({ account: tx.from, to: tx.to, data: tx.data, chain: null });
  }
}
