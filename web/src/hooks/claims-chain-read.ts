"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import type { Deployment } from "@/lib/deployments";
import { useActiveChain } from "@/hooks/use-protocol";

type KeyPart = string | number | boolean | null | undefined;

/**
 * Ad-hoc public RPC read on the active chain (no wallet, no private API). Query keys live under
 * ["protocol", ...] so every read is refreshed automatically after a confirmed protocol transaction
 * (useProtocolTx invalidates that prefix). Pass bigints as strings in `key` (query keys are JSON-hashed).
 */
export function useChainRead<T>(
  key: KeyPart[],
  read: (client: PublicClient, deployment: Deployment) => Promise<T>,
  opts: { enabled?: boolean; keepPrevious?: boolean; refetchInterval?: number | false } = {},
) {
  const { chainId, deployment, isLocal } = useActiveChain();
  const client = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["protocol", "read", chainId, deployment?.claimManager ?? null, ...key],
    enabled: !!client && !!deployment && (opts.enabled ?? true),
    queryFn: () => read(client!, deployment!),
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    refetchInterval: opts.refetchInterval ?? (isLocal ? 5_000 : 15_000),
    retry: false,
  });
}
