import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockAggregatorV3Abi, proofOfCallAbi } from '@proof-of-call/core';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

const repo = new URL('../../../../', import.meta.url);

/** Bytecode from the forge build (`forge build` must have run; CI does it before the TypeScript tests). */
function bytecode(file: string, contract: string): Hex {
  const artifact = JSON.parse(readFileSync(new URL(`out/${file}/${contract}.json`, repo), 'utf8')) as {
    bytecode: { object: Hex };
  };
  return artifact.bytecode.object;
}

export interface Anvil {
  rpcUrl: string;
  accounts: readonly Address[];
  client: PublicClient;
  stop(): void;
  /** Moves chain time forward and mines a block. */
  warp(seconds: number): Promise<void>;
}

/** Starts anvil on a port the OS picks (--port 0), so parallel test files can never share a chain. */
export async function startAnvil(): Promise<Anvil> {
  const bin = process.env.ANVIL_BIN ?? 'anvil';
  const child: ChildProcess = spawn(bin, ['--port', '0', '--chain-id', '31337'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('anvil did not start within 20 s'));
    }, 20_000);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`could not start anvil (${bin}): ${err.message}. Install Foundry or set ANVIL_BIN.`));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`anvil exited with code ${code}`));
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      const m = /Listening on 127\.0\.0\.1:(\d+)/.exec(out);
      if (m?.[1]) {
        clearTimeout(timer);
        child.stdout?.removeAllListeners('data');
        child.stdout?.resume(); // keep draining anvil's log
        resolve(Number(m[1]));
      }
    });
  });
  child.removeAllListeners('exit');
  const rpcUrl = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
  const test = createTestClient({ mode: 'anvil', transport: http(rpcUrl) });
  const accounts = await createWalletClient({ transport: http(rpcUrl) }).getAddresses();
  return {
    rpcUrl,
    accounts,
    client,
    stop: () => child.kill(),
    warp: async (seconds) => {
      await test.increaseTime({ seconds });
      await test.mine({ blocks: 1 });
    },
  };
}

export interface LocalDeployment {
  dir: string;
  poc: Address;
  btc: Address;
  eth: Address;
}

/** Deploys two mock feeds and ProofOfCall (owner and mock admin: accounts[0]) and writes deployments/local-31337.json. */
export async function deployLocal(anvil: Anvil, maxGap = 21_600, flatBandBps = 10): Promise<LocalDeployment> {
  const wallet = createWalletClient({ transport: http(anvil.rpcUrl) });
  const admin = anvil.accounts[0];
  if (!admin) throw new Error('no anvil accounts');
  const deploy = async (abi: Abi, code: Hex, args: readonly unknown[]) => {
    const hash = await wallet.deployContract({ abi, bytecode: code, args, account: admin, chain: null });
    const receipt = await anvil.client.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('no contract address');
    return { address: receipt.contractAddress, hash, block: receipt.blockNumber };
  };
  const mock = bytecode('MockAggregatorV3.sol', 'MockAggregatorV3');
  const btc = await deploy(mockAggregatorV3Abi, mock, ['BTC / USD']);
  const eth = await deploy(mockAggregatorV3Abi, mock, ['ETH / USD']);
  const poc = await deploy(proofOfCallAbi, bytecode('ProofOfCall.sol', 'ProofOfCall'), [
    admin,
    maxGap,
    flatBandBps,
    [btc.address, eth.address],
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'poc-deployments-'));
  writeFileSync(
    join(dir, 'local-31337.json'),
    JSON.stringify({
      network: 'Local anvil',
      chainId: 31337,
      explorer: '',
      rpc: anvil.rpcUrl,
      contracts: {
        ProofOfCall: { address: poc.address, tx: poc.hash, block: Number(poc.block) },
        'MockAggregatorV3 BTC / USD': { address: btc.address, description: 'BTC / USD', decimals: 8 },
        'MockAggregatorV3 ETH / USD': { address: eth.address, description: 'ETH / USD', decimals: 8 },
      },
    }),
  );
  return { dir, poc: poc.address, btc: btc.address, eth: eth.address };
}
