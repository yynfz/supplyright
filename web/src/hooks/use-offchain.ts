"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agreement,
  DocumentKind,
  ProductionMap,
  StoredDocument,
} from "@/lib/offchain-types";
import { useApi } from "./use-api";

export const offchainKeys = {
  all: ["offchain"] as const,
  agreements: (chainId: number, address?: string) => ["offchain", "agreements", chainId, address] as const,
  agreement: (chainId: number, address: string | undefined, id: string) => ["offchain", "agreement", chainId, address, id] as const,
  documents: (chainId: number, address: string | undefined, filter: string) => ["offchain", "documents", chainId, address, filter] as const,
  production: (chainId: number, address?: string) => ["offchain", "production", chainId, address] as const,
};

/**
 * Private data requires a wallet signature. Queries are disabled until the caller opts in via `enabled`
 * (pages show an "Akses data privat" button) so the signature prompt is never a surprise.
 */
export function useAgreements(enabled = true) {
  const { apiFetch, ready, chainId, address } = useApi();
  return useQuery({
    queryKey: offchainKeys.agreements(chainId, address),
    enabled: ready && enabled,
    queryFn: async () => (await apiFetch<{ agreements: Agreement[] }>("/api/agreements")).agreements,
    retry: false,
  });
}

export function useAgreement(id: string | undefined, enabled = true) {
  const { apiFetch, ready, chainId, address } = useApi();
  return useQuery({
    queryKey: offchainKeys.agreement(chainId, address, id ?? ""),
    enabled: ready && enabled && !!id,
    queryFn: () => apiFetch<{ agreement: Agreement; documents: StoredDocument[] }>(`/api/agreements/${id}`),
    retry: false,
  });
}

export type DocumentFilter = { agreementId?: string; contextKey?: string; contextPrefix?: string; sha256?: string[] };

function filterToQuery(f: DocumentFilter) {
  const p = new URLSearchParams();
  if (f.agreementId) p.set("agreementId", f.agreementId);
  if (f.contextKey) p.set("contextKey", f.contextKey);
  if (f.contextPrefix) p.set("contextPrefix", f.contextPrefix);
  if (f.sha256?.length) p.set("sha256", f.sha256.join(","));
  return p.toString();
}

export function useDocuments(filter: DocumentFilter, enabled = true) {
  const { apiFetch, ready, chainId, address } = useApi();
  const qs = filterToQuery(filter);
  return useQuery({
    queryKey: offchainKeys.documents(chainId, address, qs),
    enabled: ready && enabled && qs.length > 0,
    queryFn: async () => (await apiFetch<{ documents: StoredDocument[] }>(`/api/documents?${qs}`)).documents,
    retry: false,
  });
}

/** Map of onchain hash -> private document metadata, for labelling hashes with file names. */
export function useDocumentIndex(hashes: (string | undefined | null)[], enabled = true) {
  const clean = [...new Set(hashes.filter((h): h is string => !!h && !/^0x0+$/.test(h)).map((h) => h.toLowerCase()))].sort();
  const q = useDocuments({ sha256: clean }, enabled && clean.length > 0);
  const map = new Map<string, StoredDocument>();
  for (const d of q.data ?? []) map.set(d.sha256.toLowerCase(), d);
  return { ...q, map };
}

export function useUploadDocument() {
  const { apiFetch } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; kind: DocumentKind; agreementId?: string; contextKey?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      form.set("kind", input.kind);
      if (input.agreementId) form.set("agreementId", input.agreementId);
      if (input.contextKey) form.set("contextKey", input.contextKey);
      return (await apiFetch<{ document: StoredDocument }>("/api/documents", { method: "POST", body: form })).document;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offchain", "documents"] }),
  });
}

/** Creates a private text document (report/memo/reason) and returns it with its SHA-256 for onchain use. */
export function useCreateTextDocument() {
  const { apiFetch } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: DocumentKind; title: string; content: string; agreementId?: string; contextKey?: string }) =>
      (
        await apiFetch<{ document: StoredDocument }>("/api/documents/text", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).document,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offchain", "documents"] }),
  });
}

export function useOpenDocument() {
  const { apiFetch } = useApi();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch<{ url: string }>(`/api/documents/${id}`);
      window.open(res.url, "_blank", "noopener");
      return res;
    },
  });
}

export function useProductionMap(enabled = true) {
  const { apiFetch, ready, chainId, address } = useApi();
  return useQuery({
    queryKey: offchainKeys.production(chainId, address),
    enabled: ready && enabled,
    queryFn: () => apiFetch<ProductionMap>("/api/production"),
    retry: false,
  });
}

export function useProductionMutation() {
  const { apiFetch } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input:
      | { op: "create"; type: "material" | "product" | "dependency"; data: Record<string, unknown> }
      | { op: "update"; type: "material" | "product" | "dependency"; id: string; data: Record<string, unknown> }
      | { op: "delete"; type: "material" | "product" | "dependency"; id: string }) => {
      if (input.op === "create") {
        return apiFetch("/api/production", { method: "POST", body: JSON.stringify({ type: input.type, data: input.data }) });
      }
      if (input.op === "update") {
        return apiFetch("/api/production", { method: "PATCH", body: JSON.stringify({ type: input.type, id: input.id, data: input.data }) });
      }
      return apiFetch(`/api/production?type=${input.type}&id=${input.id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offchain", "production"] }),
  });
}

export function useAgreementMutation() {
  const { apiFetch } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; action: "verify" | "reject" | "sync"; note?: string; txHash?: string }) =>
      (
        await apiFetch<{ agreement: Agreement }>(`/api/agreements/${input.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: input.action, note: input.note, txHash: input.txHash }),
        })
      ).agreement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offchain"] }),
  });
}

export function useCreateAgreement() {
  const { apiFetch } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await apiFetch<{ agreement: Agreement }>("/api/agreements", { method: "POST", body: JSON.stringify(body) })).agreement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offchain"] }),
  });
}
