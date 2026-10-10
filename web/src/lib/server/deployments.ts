import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Deployment } from "@/lib/deployments";

/**
 * Keeps only the fields the app uses. Deployments from the retired ERC-20 (MockETH) protocol still carry a
 * `settlementToken`; their vault has a different ABI (deposit(uint256), no payable funding), so they are skipped
 * instead of producing confusing reverts. Redeploy with Deploy.s.sol to get a native-ETH deployment.
 */
function normalize(raw: Record<string, unknown>, source: string): Deployment | null {
  if (!raw || typeof raw !== "object" || !raw.chainId || !raw.vault) return null;
  if (raw.settlementToken || raw.mockToken) {
    console.warn(`[deployments] ${source}: skipped legacy token-settled deployment for chain ${raw.chainId}; redeploy for native ETH.`);
    return null;
  }
  const d = raw as unknown as Deployment;
  return {
    chainId: Number(d.chainId),
    startBlock: Number(d.startBlock ?? 0),
    ...(d.deployedAt !== undefined ? { deployedAt: Number(d.deployedAt) } : {}),
    deployer: d.deployer,
    settlementAsset: "native",
    supplyRightNFT: d.supplyRightNFT,
    protectionNFT: d.protectionNFT,
    recoveryClaimNFT: d.recoveryClaimNFT,
    vault: d.vault,
    claimManager: d.claimManager,
  };
}

/**
 * Deployments are read at request time so a redeploy (e.g. a fresh local Anvil chain) does not require
 * rebuilding the frontend. Sources, later ones override earlier ones:
 *   1. JSON files in CONTRACTS_DEPLOYMENTS_DIR (default ../contracts/deployments) written by Deploy.s.sol
 *   2. SUPPLYRIGHT_DEPLOYMENTS env var: JSON array of Deployment objects (for hosted environments)
 */
export function loadDeployments(): Record<string, Deployment> {
  const out: Record<string, Deployment> = {};
  const dir = resolve(process.cwd(), process.env.CONTRACTS_DEPLOYMENTS_DIR || "../contracts/deployments");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!/^\d+\.json$/.test(file)) continue;
      try {
        const d = normalize(JSON.parse(readFileSync(resolve(dir, file), "utf8")), file);
        if (d) out[String(d.chainId)] = d;
      } catch {
        // ignore malformed files
      }
    }
  }
  const fromEnv = process.env.SUPPLYRIGHT_DEPLOYMENTS;
  if (fromEnv) {
    for (const raw of JSON.parse(fromEnv) as Record<string, unknown>[]) {
      const d = normalize(raw, "SUPPLYRIGHT_DEPLOYMENTS");
      if (d) out[String(d.chainId)] = d;
    }
  }
  return out;
}

export function getDeployment(chainId: number): Deployment | null {
  return loadDeployments()[String(chainId)] ?? null;
}
