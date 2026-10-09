import "server-only";
import { createPublicClient, getAddress, http, verifyMessage, type Address, type Hex } from "viem";
import { claimManagerAbi, supplyRightNftAbi, vaultAbi } from "@/generated/abis";
import { AUTH_SESSION_TTL_MS, buildAuthMessage } from "@/lib/auth-message";
import { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { ROLES } from "@/lib/protocol/roles";
import { getDeployment } from "./deployments";
import { HttpError } from "./http";

export type Caller = {
  address: Address;
  chainId: number;
  roles: { admin: boolean; registrar: boolean; buyer: boolean; provider: boolean; verifier: boolean };
};

function serverRpcUrl(chainId: number) {
  if (chainId === LOCAL_CHAIN_ID) return process.env.LOCAL_RPC_URL || process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545";
  if (chainId === SEPOLIA_CHAIN_ID) {
    return process.env.SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  }
  throw new HttpError(400, `Chain ${chainId} tidak didukung.`);
}

export function serverClient(chainId: number) {
  return createPublicClient({ transport: http(serverRpcUrl(chainId)) });
}

const roleCache = new Map<string, { at: number; roles: Caller["roles"] }>();

export async function readRoles(chainId: number, address: Address): Promise<Caller["roles"]> {
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const hit = roleCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 30_000) return hit.roles;
  const d = getDeployment(chainId);
  if (!d) throw new HttpError(503, `Kontrak belum di-deploy di chain ${chainId}.`);
  const client = serverClient(chainId);
  const has = (contract: Address, abi: typeof supplyRightNftAbi, role: Hex) =>
    client.readContract({ address: contract, abi, functionName: "hasRole", args: [role, address] });
  const [admin, registrar, buyer, provider, verifier] = await Promise.all([
    has(d.supplyRightNFT, supplyRightNftAbi, ROLES.DEFAULT_ADMIN_ROLE),
    has(d.supplyRightNFT, supplyRightNftAbi, ROLES.REGISTRAR_ROLE),
    has(d.supplyRightNFT, supplyRightNftAbi, ROLES.BUYER_ROLE),
    has(d.vault, vaultAbi as unknown as typeof supplyRightNftAbi, ROLES.PROVIDER_ROLE),
    has(d.claimManager, claimManagerAbi as unknown as typeof supplyRightNftAbi, ROLES.VERIFIER_ROLE),
  ]);
  const roles = { admin, registrar, buyer, provider, verifier };
  roleCache.set(cacheKey, { at: Date.now(), roles });
  return roles;
}

/**
 * Authenticates the caller from the signed-message headers and loads their onchain roles.
 * Callers without any protocol role are rejected: offchain commercial data is for participants only.
 */
export async function requireCaller(req: Request): Promise<Caller> {
  const rawAddress = req.headers.get("x-sr-address");
  const issuedAt = req.headers.get("x-sr-issued");
  const signature = req.headers.get("x-sr-signature") as Hex | null;
  const chainId = Number(req.headers.get("x-sr-chain"));
  if (!rawAddress || !issuedAt || !signature || !chainId) {
    throw new HttpError(401, "Tanda tangan wallet diperlukan untuk mengakses data privat.");
  }
  let address: Address;
  try {
    address = getAddress(rawAddress);
  } catch {
    throw new HttpError(401, "Alamat wallet tidak valid.");
  }
  const issued = Date.parse(issuedAt);
  if (Number.isNaN(issued) || Date.now() - issued > AUTH_SESSION_TTL_MS || issued - Date.now() > 5 * 60 * 1000) {
    throw new HttpError(401, "Sesi tanda tangan kedaluwarsa. Silakan tanda tangani ulang.");
  }
  const valid = await verifyMessage({ address, message: buildAuthMessage(address, issuedAt), signature }).catch(
    () => false,
  );
  if (!valid) throw new HttpError(401, "Tanda tangan wallet tidak valid.");

  const roles = await readRoles(chainId, address);
  if (!Object.values(roles).some(Boolean)) {
    throw new HttpError(403, "Wallet ini belum memiliki peran di SupplyRight. Hubungi administrator platform.");
  }
  return { address, chainId, roles };
}

export function requireRole(caller: Caller, ...allowed: (keyof Caller["roles"])[]) {
  if (!allowed.some((r) => caller.roles[r])) {
    throw new HttpError(403, "Peran wallet Anda tidak mengizinkan aksi ini.");
  }
}

/** Registrar, admin, verifier and provider evaluate all agreements; buyers only see their own. */
export function canSeeAllAgreements(caller: Caller) {
  const r = caller.roles;
  return r.admin || r.registrar || r.verifier || r.provider;
}
