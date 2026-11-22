import type { Address, Hex } from 'viem';

export interface TxRequest {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  /** Shown on the browser signing page. Never contains the asset, direction or salt of an unrevealed call. */
  title: string;
  details: readonly string[];
}

/** Sends a prepared transaction and returns its hash. Keys never pass through this code. */
export interface Signer {
  readonly description: string;
  send(tx: TxRequest): Promise<Hex>;
}
