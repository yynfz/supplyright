"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { LOCAL_CHAIN_ID, txUrl } from "@/lib/chains";
import { decodeTxError, type DecodedError } from "@/lib/protocol/errors";
import { shortHash } from "@/lib/format";
import { protocolKeys, useActiveChain } from "./use-protocol";

export type TxPhase = "idle" | "simulating" | "signing" | "pending" | "confirmed" | "failed";

export type TxState = {
  phase: TxPhase;
  label?: string;
  /** Chain the transaction was sent on, so its explorer link stays correct after a network switch. */
  chainId?: number;
  hash?: Hex;
  blockNumber?: bigint;
  error?: DecodedError;
};

export type TxRequest = {
  label: string;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /** Native ETH sent with the call (payable functions only, e.g. vault deposit / fundAndApproveProtection). */
  value?: bigint;
};

/**
 * Sends a contract transaction with real progress reporting:
 *   simulate (decoded revert reasons before the wallet prompt) -> sign -> broadcast -> receipt.
 * Success is only reported after a receipt with status "success". Nothing is faked.
 */
export function useProtocolTx() {
  const { address, chainId: walletChainId, connector } = useAccount();
  const { chainId } = useActiveChain();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const send = useCallback(
    async (req: TxRequest): Promise<TransactionReceipt | null> => {
      if (!address) {
        toast.error("Hubungkan wallet terlebih dahulu.");
        return null;
      }
      if (!publicClient) {
        toast.error("RPC belum siap.");
        return null;
      }
      // Demo personas are Anvil's unlocked dev accounts; they must never sign anywhere but the local chain.
      if (connector?.type === "supplyrightPersona" && chainId !== LOCAL_CHAIN_ID) {
        toast.error("Persona demo hanya dapat bertransaksi di chain Anvil lokal. Hubungkan wallet Anda sendiri.");
        return null;
      }
      const toastId = toast.loading(`${req.label}: memeriksa transaksi…`);
      let hash: Hex | undefined;
      try {
        setState({ phase: "simulating", label: req.label, chainId });
        if (walletChainId !== chainId) await switchChainAsync({ chainId });

        const call = {
          address: req.address,
          abi: req.abi as Abi,
          functionName: req.functionName,
          args: (req.args ?? []) as unknown[],
          ...(req.value !== undefined ? { value: req.value } : {}),
        };
        await publicClient.simulateContract({ ...call, account: address } as never);

        setState({ phase: "signing", label: req.label, chainId });
        toast.loading(`${req.label}: konfirmasi di wallet…`, { id: toastId });
        hash = await writeContractAsync({ ...call, chainId } as never);

        setState({ phase: "pending", label: req.label, chainId, hash });
        const link = txUrl(chainId, hash);
        const openLink = () => (link.external ? window.open(link.href, "_blank", "noopener") : (window.location.href = link.href));
        toast.loading(`${req.label}: menunggu konfirmasi blok…`, {
          id: toastId,
          description: `Tx ${shortHash(hash)}`,
          ...(link.external ? { action: { label: "Etherscan", onClick: openLink } } : {}),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`Transaksi gagal (reverted) di blok ${receipt.blockNumber}.`);
        }

        setState({ phase: "confirmed", label: req.label, chainId, hash, blockNumber: receipt.blockNumber });
        toast.success(`${req.label} berhasil`, {
          id: toastId,
          description: `Terkonfirmasi di blok ${receipt.blockNumber.toString()} · ${shortHash(hash)}`,
          action: { label: link.external ? "Etherscan" : "Lihat tx", onClick: openLink },
        });
        await queryClient.invalidateQueries({ queryKey: protocolKeys.all });
        return receipt;
      } catch (e) {
        const decoded = decodeTxError(e);
        setState({ phase: "failed", label: req.label, chainId, hash, error: decoded });
        if (decoded.userRejected) toast.warning(decoded.message, { id: toastId });
        else toast.error(`${req.label} gagal`, { id: toastId, description: decoded.message });
        return null;
      }
    },
    [address, connector, publicClient, walletChainId, chainId, switchChainAsync, writeContractAsync, queryClient],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  const busy = state.phase === "simulating" || state.phase === "signing" || state.phase === "pending";

  return { send, state, reset, busy };
}
