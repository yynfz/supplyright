import type { Address } from "viem";

/** Shape written by contracts/script/Deploy.s.sol to contracts/deployments/<chainId>.json */
export type Deployment = {
  chainId: number;
  startBlock: number;
  deployedAt?: number;
  deployer: Address;
  mockToken: boolean;
  settlementToken: Address;
  supplyRightNFT: Address;
  protectionNFT: Address;
  recoveryClaimNFT: Address;
  vault: Address;
  claimManager: Address;
};

export type AppConfig = {
  deployments: Record<string, Deployment>;
};

export const CONTRACT_LABELS: Record<keyof Omit<Deployment, "chainId" | "startBlock" | "deployedAt" | "deployer" | "mockToken">, string> = {
  settlementToken: "MockETH (mETH)",
  supplyRightNFT: "SupplyRightNFT",
  protectionNFT: "ProtectionNFT",
  recoveryClaimNFT: "RecoveryClaimNFT",
  vault: "SupplyProtectionVault",
  claimManager: "SupplyClaimManager",
};
