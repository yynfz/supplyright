"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { claimManagerAbi, supplyRightNftAbi, vaultAbi } from "@/generated/abis";
import { LOCAL_CHAIN_ID, defaultChainId, isSupportedChain } from "@/lib/chains";
import type { AppConfig, Deployment } from "@/lib/deployments";
import { fetchSnapshot } from "@/lib/protocol/snapshot";
import { fetchProtocolEvents, type EntityLookup } from "@/lib/protocol/events";
import { ROLES } from "@/lib/protocol/roles";
import type { ProtocolSnapshot } from "@/lib/protocol/types";

export const protocolKeys = {
  all: ["protocol"] as const,
  snapshot: (chainId: number) => ["protocol", "snapshot", chainId] as const,
  events: (chainId: number) => ["protocol", "events", chainId] as const,
  roles: (chainId: number, address?: string) => ["protocol", "roles", chainId, address] as const,
  balances: (chainId: number, address?: string) => ["protocol", "balances", chainId, address] as const,
};

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error("Gagal memuat konfigurasi kontrak");
      return res.json();
    },
    staleTime: 60_000,
  });
}

/**
 * The chain the app reads from: the wallet's chain when it is supported, otherwise the default chain.
 * `wrongNetwork` is true when a wallet is connected to an unsupported chain.
 */
export function useActiveChain() {
  const { chainId: walletChainId, isConnected } = useAccount();
  const config = useAppConfig();
  const chainId = isConnected && isSupportedChain(walletChainId) ? walletChainId : defaultChainId;
  const deployment: Deployment | null = config.data?.deployments[String(chainId)] ?? null;
  return {
    chainId,
    deployment,
    isLocal: chainId === LOCAL_CHAIN_ID,
    configLoading: config.isLoading,
    wrongNetwork: isConnected && !isSupportedChain(walletChainId),
    walletOnActiveChain: isConnected && walletChainId === chainId,
  };
}

export function useProtocolSnapshot() {
  const { chainId, deployment, isLocal } = useActiveChain();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: protocolKeys.snapshot(chainId),
    enabled: !!client && !!deployment,
    queryFn: () => fetchSnapshot(client!, deployment!),
    refetchInterval: isLocal ? 5_000 : 15_000,
  });
}

export function useProtocolEvents() {
  const { chainId, deployment, isLocal } = useActiveChain();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: protocolKeys.events(chainId),
    enabled: !!client && !!deployment,
    queryFn: () => fetchProtocolEvents(client!, deployment!),
    refetchInterval: isLocal ? 8_000 : 30_000,
  });
}

/** Lookup maps between protection / claim / recovery ids and supply right ids. */
export function useEntityLookup(snapshot?: ProtocolSnapshot): EntityLookup {
  return useMemo(
    () => ({
      protectionToRight: new Map(snapshot?.protections.map((p) => [p.id, p.supplyRightId]) ?? []),
      claimToRight: new Map(snapshot?.claims.map((c) => [c.id, c.supplyRightId]) ?? []),
      recoveryToRight: new Map(snapshot?.recoveries.map((r) => [r.id, r.supplyRightId]) ?? []),
    }),
    [snapshot],
  );
}

export type RoleFlags = {
  admin: boolean;
  registrar: boolean;
  buyer: boolean;
  provider: boolean;
  verifier: boolean;
};

export const NO_ROLES: RoleFlags = { admin: false, registrar: false, buyer: false, provider: false, verifier: false };

export function useRoles(address?: Address) {
  const { chainId, deployment } = useActiveChain();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: protocolKeys.roles(chainId, address),
    enabled: !!client && !!deployment && !!address,
    staleTime: 30_000,
    queryFn: async (): Promise<RoleFlags> => {
      const d = deployment!;
      const has = (contract: Address, abi: typeof supplyRightNftAbi, role: `0x${string}`) =>
        client!.readContract({ address: contract, abi, functionName: "hasRole", args: [role, address!] });
      const [admin, registrar, buyer, provider, verifier] = await Promise.all([
        has(d.supplyRightNFT, supplyRightNftAbi, ROLES.DEFAULT_ADMIN_ROLE),
        has(d.supplyRightNFT, supplyRightNftAbi, ROLES.REGISTRAR_ROLE),
        has(d.supplyRightNFT, supplyRightNftAbi, ROLES.BUYER_ROLE),
        has(d.vault, vaultAbi as unknown as typeof supplyRightNftAbi, ROLES.PROVIDER_ROLE),
        has(d.claimManager, claimManagerAbi as unknown as typeof supplyRightNftAbi, ROLES.VERIFIER_ROLE),
      ]);
      return { admin, registrar, buyer, provider, verifier };
    },
  });
}

/** Native ETH in the wallet (collateral source and gas) and the address's free / locked collateral in the vault. */
export function useBalances(address?: Address) {
  const { chainId, deployment, isLocal } = useActiveChain();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: protocolKeys.balances(chainId, address),
    enabled: !!client && !!deployment && !!address,
    refetchInterval: isLocal ? 5_000 : 15_000,
    queryFn: async () => {
      const d = deployment!;
      const [eth, free, locked] = await Promise.all([
        client!.getBalance({ address: address! }),
        client!.readContract({ address: d.vault, abi: vaultAbi, functionName: "freeCollateral", args: [address!] }),
        client!.readContract({ address: d.vault, abi: vaultAbi, functionName: "lockedCollateral", args: [address!] }),
      ]);
      return { eth, free, locked };
    },
  });
}
