import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { loadNetworks, type DeploymentFiles } from '../../packages/core/src/index.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));

function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined;
}

/**
 * The deployment records are compiled into the app. A local anvil deployment is only included for `vite` (dev) or
 * when POC_LOCAL_DEPLOYMENT points at one (the end-to-end test); a normal production build never contains it.
 */
function deployments(includeLocal: boolean): DeploymentFiles {
  const files: DeploymentFiles = {};
  const testnet = readJson(`${repo}deployments/qie-testnet-1983.json`);
  const mainnetConfig = readJson(`${repo}deployments/qie-mainnet-1990.config.json`);
  const mainnetRecord = readJson(`${repo}deployments/qie-mainnet-1990.json`);
  if (testnet !== undefined) files.testnet = testnet;
  if (mainnetConfig !== undefined) files.mainnetConfig = mainnetConfig;
  if (mainnetRecord !== undefined) files.mainnetRecord = mainnetRecord;
  if (includeLocal) {
    const local = readJson(process.env.POC_LOCAL_DEPLOYMENT ?? `${repo}deployments/local-31337.json`);
    if (local !== undefined) files.local = local;
  }
  return files;
}

/** Strict CSP for the built page: own scripts and styles only, network access only to the configured RPCs. */
function contentSecurityPolicy(files: DeploymentFiles): Plugin {
  const networks = Object.values(loadNetworks(files));
  const origins = [...new Set(networks.flatMap((n) => n.rpcUrls.map((u) => new URL(u).origin)))].sort();
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src ${origins.join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src 'self'",
  ].join('; ');
  return {
    name: 'poc-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<!-- CSP -->', `<meta http-equiv="Content-Security-Policy" content="${policy}">`),
  };
}

export default defineConfig(({ command }) => {
  const files = deployments(command === 'serve' || process.env.POC_LOCAL_DEPLOYMENT !== undefined);
  return {
    base: './',
    plugins: [react(), contentSecurityPolicy(files)],
    define: { __POC_DEPLOYMENTS__: JSON.stringify(files) },
    resolve: {
      alias: { '@proof-of-call/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], viem: ['viem'] } } },
    },
    server: { host: '127.0.0.1' },
  };
});
