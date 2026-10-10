import type { Address } from "viem";

/**
 * Shape written by contracts/script/Deploy.s.sol to contracts/deployments/<chainId>.json. Collateral and payouts
 * are native ETH held by the vault, so there is no settlement token address.
 */
export type Deployment = {
  chainId: number;
  startBlock: number;
  deployedAt?: number;
  deployer: Address;
  settlementAsset?: "native";
  supplyRightNFT: Address;
  protectionNFT: Address;
  recoveryClaimNFT: Address;
  vault: Address;
  claimManager: Address;
};

export type AppConfig = {
  deployments: Record<string, Deployment>;
};

export const CONTRACT_LABELS: Record<keyof Omit<Deployment, "chainId" | "startBlock" | "deployedAt" | "deployer" | "settlementAsset">, string> = {
  supplyRightNFT: "SupplyRightNFT",
  protectionNFT: "ProtectionNFT",
  recoveryClaimNFT: "RecoveryClaimNFT",
  vault: "SupplyProtectionVault (escrow ETH)",
  claimManager: "SupplyClaimManager",
};
