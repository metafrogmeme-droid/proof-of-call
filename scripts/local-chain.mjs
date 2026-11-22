#!/usr/bin/env node
// Local demo chain for the 10-minute walkthrough (README):
//
//   npm run chain:local          start anvil on 127.0.0.1:8545, deploy two mock feeds + ProofOfCall, write
//                                deployments/local-31337.json (git-ignored), keep running until Ctrl+C
//   npm run chain:warp -- 4h     move the local chain's time forward (only ever talks to chain 31337)
//
// Uses the forge build in out/ (run `forge build` first). No keys: anvil's unlocked dev accounts sign.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createTestClient, createWalletClient, http } from 'viem';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.LOCAL_CHAIN_PORT ?? 8545);
const rpcUrl = `http://127.0.0.1:${port}`;
const deploymentsDir = process.env.DEPLOYMENTS_DIR ?? `${root}deployments`;

function artifact(file, contract) {
  const a = JSON.parse(readFileSync(`${root}out/${file}/${contract}.json`, 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

function seconds(text) {
  const m = /^(\d+)(s|m|h|d)?$/.exec(text ?? '');
  if (!m) throw new Error('usage: npm run chain:warp -- <duration> (e.g. 4h, 90m, 3600)');
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? 's'];
}

async function warp(arg) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  if ((await client.getChainId()) !== 31337) throw new Error(`${rpcUrl} is not the local chain (31337); refusing`);
  const test = createTestClient({ mode: 'anvil', transport: http(rpcUrl) });
  await test.increaseTime({ seconds: seconds(arg) });
  await test.mine({ blocks: 1 });
  const block = await client.getBlock();
  console.log(
    `local chain time is now ${new Date(Number(block.timestamp) * 1000).toISOString()} (block ${block.number})`,
  );
}

async function start() {
  const anvil = spawn('anvil', ['--port', String(port), '--chain-id', '31337'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  anvil.on('error', (err) => {
    console.error(`could not start anvil: ${err.message} (install Foundry)`);
    process.exit(1);
  });
  await new Promise((resolve, reject) => {
    let out = '';
    anvil.stdout.setEncoding('utf8');
    anvil.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('Listening on')) resolve();
    });
    anvil.on('exit', (code) => reject(new Error(`anvil exited (${code}); is port ${port} in use?`)));
  });
  anvil.stdout.resume();

  const client = createPublicClient({ transport: http(rpcUrl) });
  const wallet = createWalletClient({ transport: http(rpcUrl) });
  const [admin, publisher, verifier] = await wallet.getAddresses();
  const deploy = async ({ abi, bytecode }, args) => {
    const hash = await wallet.deployContract({ abi, bytecode, args, account: admin, chain: null });
    const receipt = await client.waitForTransactionReceipt({ hash });
    return { address: receipt.contractAddress, hash, block: Number(receipt.blockNumber) };
  };
  const mock = artifact('MockAggregatorV3.sol', 'MockAggregatorV3');
  const btc = await deploy(mock, ['BTC / USD']);
  const eth = await deploy(mock, ['ETH / USD']);
  const poc = await deploy(artifact('ProofOfCall.sol', 'ProofOfCall'), [admin, 21600, 10, [btc.address, eth.address]]);
  const record = {
    network: 'Local anvil',
    chainId: 31337,
    explorer: '',
    rpc: rpcUrl,
    contracts: {
      ProofOfCall: { address: poc.address, tx: poc.hash, block: poc.block },
      'MockAggregatorV3 BTC / USD': { address: btc.address, description: 'BTC / USD', decimals: 8 },
      'MockAggregatorV3 ETH / USD': { address: eth.address, description: 'ETH / USD', decimals: 8 },
    },
  };
  writeFileSync(`${deploymentsDir}/local-31337.json`, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`
Local chain ready at ${rpcUrl} (chain 31337)
  ProofOfCall   ${poc.address}
  BTC / USD     ${btc.address}  (mock; prices pushed by ${admin})
  ETH / USD     ${eth.address}
  publisher     ${publisher}    verifier ${verifier}   (anvil dev accounts, unlocked)
Wrote ${deploymentsDir}/local-31337.json. Next steps: README, "Run it in 10 minutes". Ctrl+C stops the chain.`);

  const stop = () => {
    anvil.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const [command, arg] = process.argv.slice(2);
(command === 'warp' ? warp(arg) : start()).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
