"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Address, Hex } from "viem";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addressUrl, nftUrl, txUrl } from "@/lib/chains";
import { isZeroAddress, isZeroHash, shortAddress, shortHash } from "@/lib/format";
import { personaFor } from "@/lib/personas";
import { useActiveChain } from "@/hooks/use-protocol";
import { cn } from "@/lib/utils";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Salin"
      className="text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3.5 text-teal-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Address with copy button, a display-only persona / role-wallet label for the active chain, and Etherscan link on Sepolia. */
export function AddressChip({ address, label, className }: { address?: Address | string | null; label?: string; className?: string }) {
  const { chainId } = useActiveChain();
  if (!address || isZeroAddress(address)) return <span className="text-muted-foreground">-</span>;
  const link = addressUrl(chainId, address);
  const persona = personaFor(address, chainId);
  const text = (
    <span className="font-mono text-xs">{shortAddress(address)}</span>
  );
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          {link ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {text}
            </a>
          ) : (
            text
          )}
        </TooltipTrigger>
        <TooltipContent className="font-mono text-xs">{address}</TooltipContent>
      </Tooltip>
      {(label || persona) && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {label ?? persona?.short}
        </span>
      )}
      <CopyButton value={address} />
    </span>
  );
}

/** bytes32 / document hash display with full value in tooltip. */
export function HashChip({ hash, label, className }: { hash?: Hex | string | null; label?: string; className?: string }) {
  if (!hash || isZeroHash(hash)) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-xs">{label ?? shortHash(hash)}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-none font-mono text-xs">{hash}</TooltipContent>
      </Tooltip>
      <CopyButton value={hash} />
    </span>
  );
}

/** Link to a transaction: Etherscan on Sepolia, the in-app receipt verifier on the local chain. */
export function TxLink({ hash, chainId: chainOverride, children, className }: { hash: Hex | string; chainId?: number; children?: React.ReactNode; className?: string }) {
  const { chainId: active } = useActiveChain();
  const chainId = chainOverride ?? active;
  const link = txUrl(chainId, hash);
  const content = (
    <>
      <span className="font-mono text-xs">{children ?? shortHash(hash)}</span>
      <ExternalLink className="size-3" />
    </>
  );
  const cls = cn("inline-flex items-center gap-1 text-teal-700 hover:underline", className);
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls} title={hash}>
      {content}
    </a>
  ) : (
    <Link href={link.href} className={cls} title={hash}>
      {content}
    </Link>
  );
}

export function NftLink({ contract, tokenId, children }: { contract: Address; tokenId: number; children: React.ReactNode }) {
  const { chainId } = useActiveChain();
  const link = nftUrl(chainId, contract, tokenId);
  if (!link) return <>{children}</>;
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}
