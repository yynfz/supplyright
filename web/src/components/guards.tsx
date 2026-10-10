"use client";

import { AlertTriangle, Clock, Loader2, PlugZap, ShieldAlert, Wallet } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/page";
import { NO_ROLES, useActiveChain, useBalances, useRoles, type RoleFlags } from "@/hooks/use-protocol";
import { chainName, localRpcUrl, supportedChains } from "@/lib/chains";
import { ROLE_LABELS, type RoleKey } from "@/lib/protocol/labels";

/** Banner when the active chain has no deployment or the wallet is on an unsupported network. */
export function NetworkBanner() {
  const { chainId, deployment, configLoading, wrongNetwork } = useActiveChain();
  if (configLoading) return null;
  if (wrongNetwork) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <AlertTriangle className="size-4 shrink-0" />
        Wallet terhubung ke jaringan yang tidak didukung. Ganti ke {supportedChains.map((c) => c.name).join(" atau ")}. Data di bawah
        dibaca dari {chainName(chainId)}; ganti jaringan sebelum mengirim transaksi.
      </div>
    );
  }
  if (!deployment) {
    return (
      <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
        <PlugZap className="size-4" />
        Kontrak SupplyRight belum di-deploy di {chainName(chainId)}. Jalankan <code className="font-mono">forge script script/Deploy.s.sol</code>{" "}
        terlebih dahulu (lihat README).
      </div>
    );
  }
  return null;
}

/**
 * Renders children only when a wallet is connected and holds one of `roles`. Otherwise explains what is
 * needed. Pass `roles` empty to only require a connection.
 */
export function RoleGate({
  roles,
  children,
  title,
}: {
  roles: RoleKey[];
  children: (ctx: { roles: RoleFlags }) => React.ReactNode;
  title?: string;
}) {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useRoles(address);
  if (!isConnected) {
    return (
      <EmptyState
        icon={Wallet}
        title={title ?? "Hubungkan wallet"}
        description="Aksi ini memerlukan wallet. Di chain lokal Anda bisa memilih persona demo di kanan atas."
        action={<ConnectButton />}
      />
    );
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Memeriksa peran onchain…
      </div>
    );
  }
  const flags = data ?? NO_ROLES;
  if (roles.length && !roles.some((r) => flags[r])) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Peran tidak sesuai"
        description={`Diperlukan peran: ${roles.map((r) => ROLE_LABELS[r]).join(" atau ")}. Peran diatur onchain oleh administrator platform.`}
      />
    );
  }
  return <>{children({ roles: flags })}</>;
}

export function useWalletBalances() {
  const { address } = useAccount();
  return useBalances(address);
}

/** Local chain only: advance block time so delivery deadlines can pass during a live demo. */
export function DevTimeControls() {
  const { isLocal } = useActiveChain();
  const qc = useQueryClient();
  if (!isLocal) return null;
  const advance = async (seconds: number, label: string) => {
    try {
      const rpc = async (method: string, params: unknown[]) => {
        const res = await fetch(localRpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
      };
      await rpc("evm_increaseTime", [seconds]);
      await rpc("evm_mine", []);
      await qc.invalidateQueries({ queryKey: ["protocol"] });
      toast.success(`Waktu chain lokal dimajukan ${label}`);
    } catch (e) {
      toast.error("Gagal memajukan waktu", { description: (e as Error).message });
    }
  };
  return (
    <div className="flex items-center gap-1 text-xs">
      <Clock className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Waktu lokal:</span>
      <Button variant="ghost" size="xs" onClick={() => advance(600, "10 menit")}>
        +10 mnt
      </Button>
      <Button variant="ghost" size="xs" onClick={() => advance(86_400, "1 hari")}>
        +1 hari
      </Button>
      <Button variant="ghost" size="xs" onClick={() => advance(30 * 86_400, "30 hari")}>
        +30 hari
      </Button>
    </div>
  );
}
