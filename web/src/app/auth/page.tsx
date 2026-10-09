"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressChip } from "@/components/onchain";

const AUTH_COOKIE = "supplyright.authenticated";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/auth")) {
    return "/dashboard";
  }
  return value;
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const [continuing, setContinuing] = useState(false);
  const destination = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);

  useEffect(() => {
    if (!isConnected) setContinuing(false);
  }, [isConnected]);

  // If the user has previously logged in and the session cookie is still valid, advance to destination
  useEffect(() => {
    if (typeof document !== "undefined") {
      const hasValidSession = document.cookie
        .split(";")
        .some((item) => item.trim() === `${AUTH_COOKIE}=1`);
      if (hasValidSession && isConnected && address) {
        router.replace(destination);
      }
    }
  }, [isConnected, address, destination, router]);

  function continueToApp() {
    if (!isConnected || !address) return;
    setContinuing(true);
    document.cookie = `${AUTH_COOKIE}=1; Path=/; Max-Age=43200; SameSite=Lax`;
    router.replace(destination);
    router.refresh();
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50 px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-navy to-slate-50" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-navy p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-teal-500 text-sm font-bold">SR</span>
                <div>
                  <p className="text-lg font-semibold">SupplyRight</p>
                  <p className="text-xs text-slate-300">Verified supply protection protocol</p>
                </div>
              </div>
              <div className="mt-16 max-w-md">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Secure workspace</p>
                <h1 className="mt-4 text-4xl font-semibold leading-tight">Connect your wallet to access the protocol.</h1>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Your wallet identifies your onchain role. Private commercial records remain protected and require a separate message signature when accessed.
                </p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-teal-300" /> Role-based protocol access</p>
              <p className="flex items-center gap-2"><LockKeyhole className="size-4 text-teal-300" /> No password or seed phrase requested</p>
            </div>
          </section>

          <section className="flex items-center p-6 sm:p-10 lg:p-12">
            <div className="w-full">
              <div className="mb-8 lg:hidden">
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-teal-500 text-sm font-bold text-white">SR</span>
                  <span className="font-semibold text-navy">SupplyRight</span>
                </div>
              </div>

              <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Wallet authentication</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-navy">Welcome to SupplyRight</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Connect an authorized wallet to continue. This step does not create a transaction or charge gas.
              </p>

              <Card className="mt-8">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="size-4 text-teal-600" /> Wallet connection
                  </CardTitle>
                  <CardDescription>Use MetaMask, Rabby, Coinbase Wallet, or another supported injected wallet.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!isConnected ? (
                    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
                      <Wallet className="mx-auto size-7 text-muted-foreground" />
                      <p className="mt-3 text-sm font-medium">No wallet connected</p>
                      <p className="mt-1 text-xs text-muted-foreground">SupplyRight never asks for your private key or recovery phrase.</p>
                      <div className="mt-4 flex justify-center"><ConnectButton showBalance={false} /></div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal-700" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-teal-900">Wallet connected</p>
                          <div className="mt-2"><AddressChip address={address} /></div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Button className="w-full" size="lg" disabled={!isConnected || continuing} onClick={continueToApp}>
                    {continuing ? "Opening workspace..." : "Continue to workspace"}
                    {!continuing && <ArrowRight className="size-4" />}
                  </Button>
                </CardContent>
              </Card>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                By continuing, you confirm that you control the connected wallet. Protocol permissions are still enforced by onchain roles.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
