"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  Factory,
  FileStack,
  Landmark,
  LayoutDashboard,
  Menu,
  Scale,
  Loader2,
  Settings,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopyButton } from "@/components/onchain";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DevTimeControls, NetworkBanner } from "@/components/guards";
import { useActiveChain, useBalances, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { PERSONAS, personaFor } from "@/lib/personas";
import { LOCAL_CHAIN_ID, addressUrl, chainName, isSupportedChain, localChainEnabled, supportedChains } from "@/lib/chains";
import { formatEth } from "@/lib/format";
import type { SepoliaRoleKey } from "@/generated/wallets.sepolia";
import { ROLE_LABELS, type RoleKey } from "@/lib/protocol/labels";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard Eksekutif", icon: LayoutDashboard },
  { href: "/registry", label: "Supply Registry", icon: FileStack },
  { href: "/protection", label: "Protection Center", icon: ShieldCheck },
  { href: "/production", label: "Production Risk", icon: Factory },
  { href: "/claims", label: "Claims Center", icon: Scale },
  { href: "/provider", label: "Provider Dashboard", icon: Landmark },
  { href: "/verify", label: "Verifikasi Publik", icon: BadgeCheck },
  { href: "/admin", label: "Admin & Peran", icon: Settings },
];

function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-8 place-items-center rounded-md",
          dark ? "bg-white/10 ring-1 ring-white/10" : "bg-navy",
        )}
      >
        <Image src="/supplyright-logo.png" alt="" width={24} height={24} className="size-6 object-contain" priority />
      </span>
      <span className={cn("text-base font-semibold tracking-tight", dark ? "text-white" : "text-navy")}>SupplyRight</span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href === "/registry" && pathname.startsWith("/supply/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <item.icon className={cn("size-4", active ? "text-teal-300" : "text-sidebar-foreground/60")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const { chainId } = useActiveChain();
  const snap = useProtocolSnapshot();
  return (
    <div className="space-y-1 rounded-md border border-sidebar-border p-3 text-[11px] text-sidebar-foreground/70">
      <p className="flex items-center gap-1.5 font-medium text-sidebar-foreground">
        <span className={cn("size-1.5 rounded-full", snap.data ? "bg-teal-400" : snap.isError ? "bg-rose-400" : "bg-amber-400")} />
        {chainName(chainId)}
      </p>
      <p>{snap.data ? `Blok #${snap.data.blockNumber.toString()}` : snap.isError ? "RPC tidak terjangkau" : "Menghubungkan…"}</p>
      {/* <p className="pt-1 text-sidebar-foreground/50">Prototipe testnet. Nilai fiktif, tanpa nilai moneter. Belum diaudit.</p> */}
    </div>
  );
}

function PersonaSwitcher() {
  const { connector, address } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { isLocal } = useActiveChain();
  if (!localChainEnabled || !isLocal) return null;
  const current = personaFor(address, LOCAL_CHAIN_ID);
  const choose = async (id: string) => {
    const target = connectors.find((c) => c.id === id);
    if (!target) return;
    try {
      if (connector) await disconnectAsync();
      await connectAsync({ connector: target });
    } catch (e) {
      toast.error("Gagal mengganti persona", { description: (e as Error).message });
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserRound className="size-4 text-teal-600" />
          <span className="hidden sm:inline">{current ? current.short : "Persona demo"}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs">
          Persona demo (Anvil lokal) — akun dev Anvil yang sudah diberi peran oleh Deploy script
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PERSONAS.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => choose(p.id)} className="flex flex-col items-start gap-0.5">
            <span className={cn("text-sm font-medium", current?.id === p.id && "text-teal-700")}>{p.name}</span>
            <span className="text-xs text-muted-foreground">{p.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ROLE_SHORT: Record<RoleKey, string> = {
  admin: "Admin",
  registrar: "Registrar",
  buyer: "Buyer",
  provider: "Provider",
  verifier: "Verifier",
};

/** Which onchain role a configured Sepolia role wallet is expected to hold (used only to flag a mismatch). */
const ALIAS_ROLE: Record<SepoliaRoleKey, RoleKey> = { admin: "admin", buyer: "buyer", provider: "provider", verifier: "verifier" };

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-navy">{children}</dd>
    </div>
  );
}

/**
 * Connected-wallet panel. Everything shown comes from the connected wallet (wagmi) and public chain reads:
 * roles from onchain hasRole (useRoles), balances from the RPC, NFT ownership from the protocol snapshot.
 * The configured alias is a label only and never unlocks an action; actions stay gated by onchain roles and are
 * signed by this wallet.
 */
function ConnectedWalletPanel() {
  const { address, chainId: walletChainId } = useAccount();
  const { chainId, wrongNetwork, deployment } = useActiveChain();
  const { switchChain, isPending: switching } = useSwitchChain();
  const roles = useRoles(address);
  const balances = useBalances(address);
  const snap = useProtocolSnapshot();

  if (!address) return null;

  const etherscan = addressUrl(chainId, address);
  const alias = personaFor(address, chainId);
  const aliasKey = alias && "key" in alias ? alias.key : undefined;
  const heldRoles = roles.data ? (Object.keys(roles.data) as RoleKey[]).filter((k) => roles.data![k]) : [];
  const aliasMismatch = !!roles.data && !!aliasKey && !roles.data[ALIAS_ROLE[aliasKey]];
  const same = (a?: string | null) => !!a && a.toLowerCase() === address.toLowerCase();
  const owned = snap.data
    ? {
        rights: snap.data.supplyRights.filter((r) => same(r.owner)).length,
        protections: snap.data.protections.filter((p) => same(p.nftOwner)).length,
        recoveries: snap.data.recoveries.filter((r) => same(r.owner)).length,
      }
    : null;
  const showCollateral = !!roles.data?.provider || (!!balances.data && (balances.data.free > 0n || balances.data.locked > 0n));
  const summary = wrongNetwork
    ? "Jaringan salah"
    : roles.isLoading
      ? "Memeriksa…"
      : heldRoles.length
        ? `${ROLE_SHORT[heldRoles.includes("admin") ? "admin" : heldRoles[0]]}${heldRoles.length > 1 ? ` +${heldRoles.length - 1}` : ""}`
        : "Tanpa peran";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" aria-label={`Detail wallet terhubung: ${summary}`}>
          {wrongNetwork ? <AlertTriangle className="size-4 text-amber-600" /> : <Wallet className="size-4 text-teal-600" />}
          <span
            className={cn(
              "hidden rounded px-1.5 py-0.5 text-[10px] font-semibold sm:inline",
              wrongNetwork ? "bg-amber-100 text-amber-900" : heldRoles.length ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-600",
            )}
          >
            {summary}
          </span>
          <span className="hidden text-xs tabular-nums text-slate-700 lg:inline">{formatEth(balances.data?.eth, { digits: 3 })}</span>
          <ChevronDown className="hidden size-3.5 sm:block" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wallet terhubung</p>
          <p className="mt-1 flex items-start gap-1.5 font-mono text-xs break-all text-navy">
            {address}
            <CopyButton value={address} />
          </p>
          {etherscan && (
            <a href={etherscan.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">
              Lihat di Sepolia Etherscan <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <div className="rounded-md border p-2.5 text-xs">
          <p className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Jaringan wallet</span>
            <span className={cn("font-medium", wrongNetwork ? "text-amber-700" : "text-navy")}>
              {walletChainId === undefined ? "-" : isSupportedChain(walletChainId) ? chainName(walletChainId) : `Chain ${walletChainId} (tidak didukung)`}
            </span>
          </p>
          {wrongNetwork ? (
            <div className="mt-2 space-y-2 rounded bg-amber-50 p-2 text-amber-900">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Jaringan ini tidak didukung. Data di bawah dibaca dari {chainName(chainId)}; ganti jaringan wallet sebelum mengirim transaksi.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {supportedChains.map((c) => (
                  <Button key={c.id} size="xs" variant="outline" disabled={switching} onClick={() => switchChain({ chainId: c.id })}>
                    Ganti ke {c.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            !deployment && <p className="mt-1 text-rose-700">Kontrak SupplyRight belum di-deploy di {chainName(chainId)}.</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-navy">Peran onchain</p>
          {!deployment ? (
            <p className="text-xs text-muted-foreground">Tidak ada kontrak untuk dibaca.</p>
          ) : roles.isLoading ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Membaca hasRole…
            </p>
          ) : roles.error ? (
            <p className="text-xs text-rose-700">Gagal membaca peran: {(roles.error as Error).message}</p>
          ) : heldRoles.length ? (
            <div className="flex flex-wrap gap-1">
              {heldRoles.map((k) => (
                <span key={k} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-teal-200">
                  {ROLE_LABELS[k]}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Wallet ini belum memiliki peran SupplyRight onchain. Data publik tetap dapat dibaca; tindakan memerlukan peran.</p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">Dibaca langsung dari kontrak di {chainName(chainId)} (hasRole). Hanya peran onchain yang membuka tindakan.</p>
          {alias && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Alias konfigurasi: <span className="font-mono">{"role" in alias ? alias.role : alias.id}</span> ({alias.short}) · label saja, bukan otorisasi.
              {aliasMismatch && <span className="mt-0.5 block text-amber-700">Peran {alias.short} untuk alias ini belum diberikan onchain.</span>}
            </p>
          )}
        </div>

        <dl className="space-y-1.5 border-t pt-3">
          <PanelRow label="Saldo ETH wallet">{balances.isLoading ? "…" : formatEth(balances.data?.eth)}</PanelRow>
          {showCollateral && (
            <>
              <PanelRow label="Collateral bebas di vault">{formatEth(balances.data?.free)}</PanelRow>
              <PanelRow label="Collateral terkunci di vault">{formatEth(balances.data?.locked)}</PanelRow>
            </>
          )}
          <PanelRow label="Total escrow vault">{snap.isLoading ? "…" : formatEth(snap.data?.vault.ethBalance)}</PanelRow>
        </dl>

        <div className="border-t pt-3">
          <p className="mb-1.5 text-xs font-semibold text-navy">NFT milik wallet ini</p>
          {owned ? (
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "SupplyRight", value: owned.rights },
                { label: "Protection", value: owned.protections },
                { label: "Recovery Claim", value: owned.recoveries },
              ].map((n) => (
                <div key={n.label} className="flex flex-col-reverse rounded-md bg-slate-50 p-2">
                  <dt className="text-[10px] text-muted-foreground">{n.label}</dt>
                  <dd className="text-base font-semibold tabular-nums text-navy">{n.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">{snap.isError ? "Gagal membaca kontrak." : deployment ? "Membaca kontrak…" : "-"}</p>
          )}
          {snap.data && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Per blok #{snap.data.blockNumber.toString()} · {chainName(chainId)}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 bg-sidebar px-4 py-5 lg:flex">
        <Logo dark />
        <NavLinks />
        <div className="mt-auto">
          <SidebarFooter />
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-white/90 px-4 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-4 text-sidebar-foreground">
              <SheetTitle className="sr-only">Navigasi</SheetTitle>
              <div className="mb-6">
                <Logo dark />
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
              <div className="mt-6">
                <SidebarFooter />
              </div>
            </SheetContent>
          </Sheet>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden xl:block">
            <DevTimeControls />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ConnectedWalletPanel />
            <PersonaSwitcher />
            <ConnectButton chainStatus={{ smallScreen: "none", largeScreen: "icon" }} showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} />
          </div>
        </header>
        <NetworkBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
