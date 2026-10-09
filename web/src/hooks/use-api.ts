"use client";

import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { AUTH_SESSION_TTL_MS, buildAuthMessage } from "@/lib/auth-message";
import { useActiveChain } from "./use-protocol";

type Session = { issuedAt: string; signature: string };

const key = (address: string) => `supplyright.session.${address.toLowerCase()}`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Authenticated fetch for the private offchain API. The wallet signs a short message once per 12 hours;
 * the signature is cached in sessionStorage and sent as headers. The server verifies it and checks
 * onchain roles before touching Supabase.
 */
export function useApi() {
  const { address } = useAccount();
  const { chainId } = useActiveChain();
  const { signMessageAsync } = useSignMessage();

  const getSession = useCallback(async (): Promise<Session> => {
    if (!address) throw new ApiError("Hubungkan wallet untuk mengakses data privat.", 401);
    try {
      const cached = sessionStorage.getItem(key(address));
      if (cached) {
        const s = JSON.parse(cached) as Session;
        if (Date.now() - Date.parse(s.issuedAt) < AUTH_SESSION_TTL_MS - 10 * 60 * 1000) return s;
      }
    } catch {}
    const issuedAt = new Date().toISOString();
    const signature = await signMessageAsync({ message: buildAuthMessage(address, issuedAt) });
    const session = { issuedAt, signature };
    try {
      sessionStorage.setItem(key(address), JSON.stringify(session));
    } catch {}
    return session;
  }, [address, signMessageAsync]);

  const apiFetch = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const session = await getSession();
      const headers = new Headers(init.headers);
      headers.set("x-sr-address", address!);
      headers.set("x-sr-issued", session.issuedAt);
      headers.set("x-sr-signature", session.signature);
      headers.set("x-sr-chain", String(chainId));
      if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const res = await fetch(path, { ...init, headers });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        if (res.status === 401) {
          try {
            sessionStorage.removeItem(key(address!));
          } catch {}
        }
        throw new ApiError(data?.error ?? `Permintaan gagal (${res.status})`, res.status);
      }
      return data as T;
    },
    [address, chainId, getSession],
  );

  return { apiFetch, ready: !!address, address, chainId };
}
