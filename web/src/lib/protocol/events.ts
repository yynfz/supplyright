import { decodeEventLog, type Abi, type Address, type Hex, type Log, type PublicClient } from "viem";
import {
  claimManagerAbi,
  protectionNftAbi,
  recoveryClaimNftAbi,
  supplyRightNftAbi,
  vaultAbi,
} from "@/generated/abis";
import type { Deployment } from "@/lib/deployments";

export type ContractKey = "supplyRightNFT" | "protectionNFT" | "recoveryClaimNFT" | "vault" | "claimManager";

export type ProtocolEvent = {
  id: string;
  contract: ContractKey;
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  timestamp: number;
};

const ABIS: Record<ContractKey, Abi> = {
  supplyRightNFT: supplyRightNftAbi as Abi,
  protectionNFT: protectionNftAbi as Abi,
  recoveryClaimNFT: recoveryClaimNftAbi as Abi,
  vault: vaultAbi as Abi,
  claimManager: claimManagerAbi as Abi,
};

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_LOG_CHUNK_SIZE = 20_000n;
const SEPOLIA_FREE_TIER_LOG_CHUNK_SIZE = 10n;

function configuredLogChunkSize() {
  const value = process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE;
  if (!value) return DEFAULT_LOG_CHUNK_SIZE;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : DEFAULT_LOG_CHUNK_SIZE;
  } catch {
    return DEFAULT_LOG_CHUNK_SIZE;
  }
}

function initialLogChunkSize(d: Deployment) {
  const configured = configuredLogChunkSize();
  if (d.chainId === SEPOLIA_CHAIN_ID && configured > SEPOLIA_FREE_TIER_LOG_CHUNK_SIZE) {
    return SEPOLIA_FREE_TIER_LOG_CHUNK_SIZE;
  }
  return configured;
}

function smallerLogChunkSize(chunk: bigint) {
  if (chunk <= 1n) return null;
  const next = chunk / 2n;
  return next > 0n ? next : 1n;
}

export function decodeProtocolLog(d: Deployment, log: Log, timestamp = 0): ProtocolEvent | null {
  const contract = (Object.keys(ABIS) as ContractKey[]).find(
    (k) => d[k].toLowerCase() === (log.address as Address).toLowerCase(),
  );
  if (!contract) return null;
  try {
    const decoded = decodeEventLog({ abi: ABIS[contract], data: log.data, topics: log.topics });
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      contract,
      name: decoded.eventName ?? "Unknown",
      args: (decoded.args ?? {}) as Record<string, unknown>,
      blockNumber: log.blockNumber ?? 0n,
      logIndex: log.logIndex ?? 0,
      transactionHash: log.transactionHash as Hex,
      timestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches every protocol event since the deployment block. Ranges are chunked (public Sepolia RPCs cap
 * eth_getLogs ranges tightly) and the chunk is halved automatically if the RPC rejects it.
 */
export async function fetchProtocolEvents(client: PublicClient, d: Deployment): Promise<ProtocolEvent[]> {
  const latest = await client.getBlockNumber();
  const addresses = [d.supplyRightNFT, d.protectionNFT, d.recoveryClaimNFT, d.vault, d.claimManager];
  const logs: Log[] = [];
  let from = BigInt(d.startBlock ?? 0);
  let chunk = initialLogChunkSize(d);

  while (from <= latest) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
    try {
      const batch = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
      logs.push(...batch);
      from = to + 1n;
    } catch (e) {
      const smaller = smallerLogChunkSize(chunk);
      if (smaller === null) throw e;
      chunk = smaller;
    }
  }

  const blockNumbers = [...new Set(logs.map((l) => l.blockNumber!))];
  const timestamps = new Map<bigint, number>();
  await Promise.all(
    blockNumbers.map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      timestamps.set(n, Number(b.timestamp));
    }),
  );

  return logs
    .map((l) => decodeProtocolLog(d, l, timestamps.get(l.blockNumber!) ?? 0))
    .filter((e): e is ProtocolEvent => e !== null)
    .sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    );
}

const toNum = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : undefined);

export type EntityLookup = {
  protectionToRight: Map<number, number>;
  claimToRight: Map<number, number>;
  recoveryToRight: Map<number, number>;
};

/**
 * Maps an event to the supply right it concerns (directly or via protection / claim ids), so the audit
 * timeline of a single supply right can be filtered.
 */
export function relatedSupplyRightId(e: ProtocolEvent, lookup: EntityLookup): number | undefined {
  const a = e.args;
  if (a.supplyRightId !== undefined) return toNum(a.supplyRightId);
  if (e.contract === "supplyRightNFT" && a.tokenId !== undefined) return toNum(a.tokenId);
  if (e.contract === "protectionNFT" && a.tokenId !== undefined) return lookup.protectionToRight.get(toNum(a.tokenId)!);
  if (e.contract === "recoveryClaimNFT" && a.tokenId !== undefined) return lookup.recoveryToRight.get(toNum(a.tokenId)!);
  if (a.protectionId !== undefined) return lookup.protectionToRight.get(toNum(a.protectionId)!);
  if (a.claimId !== undefined) return lookup.claimToRight.get(toNum(a.claimId)!);
  return undefined;
}
