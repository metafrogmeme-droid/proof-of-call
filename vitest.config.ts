import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const testnet: unknown = JSON.parse(
  readFileSync(new URL('./deployments/qie-testnet-1983.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  resolve: {
    alias: {
      '@proof-of-call/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  // Web app tests: the deployment records the app is built with (testnet only here), JSX without a React import.
  define: { __POC_DEPLOYMENTS__: JSON.stringify({ testnet }) },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
