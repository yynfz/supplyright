"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  ChevronDown,
  Factory,
  FileStack,
  Landmark,
  LayoutDashboard,
  Menu,
  Scale,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DevTimeControls, NetworkBanner } from "@/components/guards";
import { useActiveChain, useProtocolSnapshot, useRoles } from "@/hooks/use-protocol";
import { PERSONAS, personaFor } from "@/lib/personas";
import { chainName, localChainEnabled } from "@/lib/chains";
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
      <span className="grid size-8 place-items-center rounded-md bg-teal-500 text-sm font-bold text-white">SR</span>
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
  const current = personaFor(address);
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

import { useBalances } from "@/hooks/use-protocol";
import { formatEth, formatToken, shortAddress } from "@/lib/format";
import { addressUrl } from "@/lib/chains";
import { ExternalLink, Wallet } from "lucide-react";

function ConnectedRoleOverview() {
  const { address } = useAccount();
  const { chainId } = useActiveChain();
  const { data: roles } = useRoles(address);
  const { data: balances } = useBalances(address);
  const persona = personaFor(address);

  if (!address) return null;

  const etherscan = addressUrl(chainId, address);
  const roleName = persona?.short || (roles?.admin ? "Admin" : roles?.buyer ? "Buyer" : roles?.provider ? "Provider" : roles?.verifier ? "Verifier" : null);

  return (
    <div className="hidden items-center gap-2 rounded-md border bg-slate-50 px-2.5 py-1 text-xs text-slate-700 md:flex">
      <div className="flex items-center gap-1.5 font-medium">
        <Wallet className="size-3.5 text-teal-600" />
        {roleName && (
          <span className="rounded bg-teal-100 px-1.5 py-0.2 text-[10px] font-semibold text-teal-900">
            {roleName}
          </span>
        )}
        {etherscan ? (
          <a
            href={etherscan.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-mono text-[11px] text-slate-800 hover:text-teal-700 hover:underline"
          >
            {shortAddress(address)}
            <ExternalLink className="size-2.5" />
          </a>
        ) : (
          <span className="font-mono text-[11px]">{shortAddress(address)}</span>
        )}
      </div>

      {balances && (
        <div className="flex items-center gap-2 border-l border-slate-200 pl-2 text-[11px]">
          <span>
            ETH: <strong className="font-semibold text-slate-900">{formatEth(balances.eth, { digits: 3 })}</strong>
          </span>
          {balances.locked > 0n && (
            <span>
              Escrow: <strong className="font-semibold text-teal-700">{formatToken(balances.locked, { digits: 3 })}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RoleChips() {
  const { address } = useAccount();
  const { data } = useRoles(address);
  if (!address || !data) return null;
  const keys = (Object.keys(data) as RoleKey[]).filter((k) => data[k]);
  if (!keys.length) {
    return <span className="hidden text-xs text-muted-foreground lg:inline">Tanpa peran</span>;
  }
  return (
    <div className="hidden items-center gap-1 xl:flex">
      {keys.map((k) => (
        <span key={k} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-teal-200">
          {ROLE_LABELS[k]}
        </span>
      ))}
    </div>
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
            <RoleChips />
            <ConnectedRoleOverview />
            <PersonaSwitcher />
            <ConnectButton chainStatus="icon" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} />
          </div>
        </header>
        <NetworkBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
