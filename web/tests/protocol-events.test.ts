import assert from "node:assert/strict";
import test from "node:test";
import type { Address, PublicClient } from "viem";
import { fetchProtocolEvents } from "../src/lib/protocol/events";
import type { Deployment } from "../src/lib/deployments";

const ADDRESS = "0x0000000000000000000000000000000000000001" as Address;

function deployment(chainId: number, startBlock: number): Deployment {
  return {
    chainId,
    startBlock,
    deployer: ADDRESS,
    mockToken: true,
    settlementToken: ADDRESS,
    supplyRightNFT: ADDRESS,
    protectionNFT: ADDRESS,
    recoveryClaimNFT: ADDRESS,
    vault: ADDRESS,
    claimManager: ADDRESS,
  };
}

function eventClient(latest: bigint, maxRange: bigint) {
  const calls: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => latest,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock?: bigint; toBlock?: bigint }) => {
      const from = fromBlock ?? 0n;
      const to = toBlock ?? from;
      calls.push([from, to]);
      if (to - from + 1n > maxRange) throw new Error(`eth_getLogs range must be <= ${maxRange}`);
      return [];
    },
    getBlock: async () => ({ timestamp: 0n }),
  } as unknown as PublicClient;
  return { calls, client };
}

async function withLogChunkEnv<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE;
  if (value === undefined) delete process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE;
  else process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE;
    else process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE = previous;
  }
}

test("Sepolia log reads stay within Alchemy free-tier 10-block windows", async () => {
  await withLogChunkEnv("20000", async () => {
    const source = eventClient(123n, 10n);
    assert.deepEqual(await fetchProtocolEvents(source.client, deployment(11155111, 100)), []);
    assert.deepEqual(source.calls, [[100n, 109n], [110n, 119n], [120n, 123n]]);
  });
});

test("rejected log ranges keep shrinking below the former 500-block floor", async () => {
  await withLogChunkEnv("12", async () => {
    const source = eventClient(8n, 3n);
    assert.deepEqual(await fetchProtocolEvents(source.client, deployment(31337, 1)), []);
    assert.deepEqual(source.calls, [[1n, 8n], [1n, 6n], [1n, 3n], [4n, 6n], [7n, 8n]]);
  });
});
