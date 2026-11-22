import { parseCallRoute, type CallRoute } from '@proof-of-call/core';
import { getAddress, isAddress, type Address } from 'viem';
import { useEffect, useState } from 'react';

/** Hash routes, so the app works on any static host (no rewrites) and the reveal opening never reaches a server. */
export type Route =
  | { page: 'network'; chainId: number }
  | { page: 'publisher'; chainId: number; publisher: Address }
  | { page: 'call'; route: CallRoute }
  | { page: 'about' }
  | { page: 'home' }
  | { page: 'not-found'; hash: string };

export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (h === '' || h === '/') return { page: 'home' };
  if (h === '/about') return { page: 'about' };
  let m = /^\/net\/(\d+)$/.exec(h);
  if (m?.[1]) return { page: 'network', chainId: Number(m[1]) };
  m = /^\/publisher\/(\d+)\/(0x[0-9a-fA-F]{40})$/.exec(h);
  if (m?.[1] && m[2] && isAddress(m[2], { strict: false }))
    return { page: 'publisher', chainId: Number(m[1]), publisher: getAddress(m[2]) };
  if (h.startsWith('/call/')) {
    try {
      const route = parseCallRoute(h);
      if (route) return { page: 'call', route };
    } catch {
      // malformed opening parameters: fall through to not-found
    }
  }
  return { page: 'not-found', hash: h };
}

export const href = {
  network: (chainId: number) => `#/net/${chainId}`,
  publisher: (chainId: number, publisher: Address) => `#/publisher/${chainId}/${publisher}`,
  about: () => '#/about',
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}
