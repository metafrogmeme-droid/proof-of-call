import type { SnapshotStore } from '@proof-of-call/core';

/** localStorage, if the browser allows it. Only a per-viewer cache of public chain data; never required. */
export function browserStore(): SnapshotStore | null {
  try {
    const ls = window.localStorage;
    const probe = '__poc_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (key) => {
        try {
          return ls.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        ls.setItem(key, value);
      },
    };
  } catch {
    return null;
  }
}
