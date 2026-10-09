"use client";

import { useState } from "react";
import { FileCheck2, FileText, KeyRound, Loader2, Upload } from "lucide-react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HashChip } from "@/components/onchain";
import { useOpenDocument, useUploadDocument } from "@/hooks/use-offchain";
import { DOCUMENT_KIND_LABEL, type DocumentKind, type StoredDocument } from "@/lib/offchain-types";
import { cn } from "@/lib/utils";

const UNLOCK_KEY = "supplyright.private-unlocked";

/**
 * Private (offchain) data is only fetched after the user explicitly unlocks it, which triggers the
 * one-time wallet signature. Returns [unlocked, unlockButton].
 */
export function usePrivateAccess(): [boolean, React.ReactNode] {
  const { address } = useAccount();
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(UNLOCK_KEY) === "1";
    } catch {
      return false;
    }
  });
  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={!address}
      onClick={() => {
        try {
          sessionStorage.setItem(UNLOCK_KEY, "1");
        } catch {}
        setUnlocked(true);
      }}
    >
      <KeyRound className="size-4" />
      Buka data privat
    </Button>
  );
  return [unlocked && !!address, button];
}

export function PrivateDataNotice({ action }: { action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">Data komersial privat tersimpan offchain</p>
        <p className="text-xs text-muted-foreground">
          Nama pemasok, harga, dan dokumen hanya ditampilkan setelah Anda menandatangani pesan login (tanpa biaya). Onchain
          hanya tersimpan hash dokumen.
        </p>
      </div>
      {action}
    </div>
  );
}

/**
 * Upload a private document. The file is hashed (SHA-256) server-side and stored in the private bucket;
 * the returned hash is what gets submitted onchain.
 */
export function DocumentUpload({
  kind,
  agreementId,
  contextKey,
  value,
  onUploaded,
  label,
  className,
  disabled,
}: {
  kind: DocumentKind;
  agreementId?: string;
  contextKey?: string;
  value?: StoredDocument | null;
  onUploaded: (doc: StoredDocument) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const upload = useUploadDocument();
  const inputId = `upload-${kind}-${contextKey ?? agreementId ?? "new"}`;
  return (
    <div className={cn("rounded-md border p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label ?? DOCUMENT_KIND_LABEL[kind]}</p>
        <label htmlFor={inputId}>
          <Button asChild variant="outline" size="sm" disabled={disabled || upload.isPending}>
            <span className="cursor-pointer">
              {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {value ? "Ganti" : "Unggah"}
            </span>
          </Button>
        </label>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          disabled={disabled || upload.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const doc = await upload.mutateAsync({ file, kind, agreementId, contextKey });
              onUploaded(doc);
              toast.success("Dokumen tersimpan privat", { description: `SHA-256 ${doc.sha256.slice(0, 18)}…` });
            } catch (err) {
              toast.error("Unggah gagal", { description: (err as Error).message });
            }
          }}
        />
      </div>
      {value ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <FileCheck2 className="size-3.5 text-teal-600" />
          <span className="truncate">{value.file_name}</span>
          <span>·</span>
          <HashChip hash={value.sha256} />
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Maks. 10 MB. Hanya hash SHA-256 yang dicatat onchain.</p>
      )}
    </div>
  );
}

/** A hash shown with the matching private document (when the viewer may access it). */
export function DocumentHash({ hash, doc, fallbackLabel }: { hash?: string | null; doc?: StoredDocument; fallbackLabel?: string }) {
  const open = useOpenDocument();
  if (!hash || /^0x0+$/.test(hash)) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <HashChip hash={hash} />
      {doc ? (
        <button
          type="button"
          onClick={() =>
            open.mutate(doc.id, { onError: (e) => toast.error("Tidak dapat membuka dokumen", { description: (e as Error).message }) })
          }
          className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"
        >
          <FileText className="size-3.5" />
          {doc.file_name}
        </button>
      ) : (
        fallbackLabel && <span className="text-xs text-muted-foreground">{fallbackLabel}</span>
      )}
    </span>
  );
}
