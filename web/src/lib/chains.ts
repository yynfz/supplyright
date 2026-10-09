import { defineChain, type Chain } from "viem";
import { sepolia } from "viem/chains";

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

export const localChainEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_CHAIN !== "false";
export const sepoliaRpcUrl =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
export const localRpcUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545";

export const anvilChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "Anvil Lokal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [localRpcUrl] } },
  testnet: true,
});

export const sepoliaChain: Chain = {
  ...sepolia,
  rpcUrls: { default: { http: [sepoliaRpcUrl] } },
};

export const supportedChains: readonly [Chain, ...Chain[]] = localChainEnabled
  ? [anvilChain, sepoliaChain]
  : [sepoliaChain];

export const defaultChainId = Number(
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || (localChainEnabled ? LOCAL_CHAIN_ID : SEPOLIA_CHAIN_ID),
);

export function isSupportedChain(chainId: number | undefined): chainId is number {
  return chainId !== undefined && supportedChains.some((c) => c.id === chainId);
}

export function chainName(chainId: number): string {
  return supportedChains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
}

export function rpcUrlFor(chainId: number): string {
  return chainId === LOCAL_CHAIN_ID ? localRpcUrl : sepoliaRpcUrl;
}

const ETHERSCAN = "https://sepolia.etherscan.io";

/** Etherscan on Sepolia; the in-app verifier for the local chain (which has no public explorer). */
export function txUrl(chainId: number, hash: string): { href: string; external: boolean } {
  if (chainId === SEPOLIA_CHAIN_ID) return { href: `${ETHERSCAN}/tx/${hash}`, external: true };
  return { href: `/verify?chain=${chainId}&tx=${hash}`, external: false };
}

export function addressUrl(chainId: number, address: string): { href: string; external: boolean } | null {
  if (chainId === SEPOLIA_CHAIN_ID) return { href: `${ETHERSCAN}/address/${address}`, external: true };
  return null;
}

export function nftUrl(chainId: number, contract: string, tokenId: number | bigint) {
  if (chainId === SEPOLIA_CHAIN_ID) {
    return { href: `${ETHERSCAN}/nft/${contract}/${tokenId.toString()}`, external: true };
  }
  return null;
}
