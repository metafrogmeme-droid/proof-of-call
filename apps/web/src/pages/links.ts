import { callRoute, type CallRecord, type NetworkInfo } from '@proof-of-call/core';

export function callHref(network: NetworkInfo, call: Pick<CallRecord, 'publisher' | 'callId'>): string {
  return callRoute(network.chainId, call.publisher, call.callId);
}
