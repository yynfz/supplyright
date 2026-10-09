import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Deployment } from "@/lib/deployments";

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
        const d = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Deployment;
        if (d.chainId && d.vault) out[String(d.chainId)] = d;
      } catch {
        // ignore malformed files
      }
    }
  }
  const fromEnv = process.env.SUPPLYRIGHT_DEPLOYMENTS;
  if (fromEnv) {
    for (const d of JSON.parse(fromEnv) as Deployment[]) out[String(d.chainId)] = d;
  }
  return out;
}

export function getDeployment(chainId: number): Deployment | null {
  return loadDeployments()[String(chainId)] ?? null;
}
