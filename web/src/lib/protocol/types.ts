import type { Address, Hex } from "viem";

// Mirrors contracts/src/SupplyTypes.sol (enum order matters).

export enum SupplyStatus {
  Registered = 0,
  Active = 1,
  Fulfilled = 2,
  UnderAssessment = 3,
  Defaulted = 4,
  Closed = 5,
}

export enum RequestStatus {
  None = 0,
  Pending = 1,
  Approved = 2,
  Rejected = 3,
  Cancelled = 4,
}

export enum ProtectionStatus {
  None = 0,
  Active = 1,
  Exhausted = 2,
  Released = 3,
}

export enum ProtectionClaimStatus {
  NoClaim = 0,
  ClaimPending = 1,
  ClaimApproved = 2,
  Disputed = 3,
  PartiallyPaid = 4,
  Exhausted = 5,
  Released = 6,
}

export enum ClaimStatus {
  None = 0,
  Submitted = 1,
  Approved = 2,
  Rejected = 3,
  Disputed = 4,
  Settled = 5,
  Withdrawn = 6,
}

export enum DefaultType {
  None = 0,
  Partial = 1,
  Complete = 2,
}

export enum RecoveryStatus {
  Open = 0,
  InRecovery = 1,
  PartiallyRecovered = 2,
  Recovered = 3,
  WrittenOff = 4,
}

/** Quantities are stored onchain with 3 implied decimals (50 MT = 50_000). */
export const QTY_DECIMALS = 3;
export const BPS = 10_000;

export type SupplyRight = {
  id: number;
  owner: Address;
  buyer: Address;
  deliveryDeadline: number;
  registeredAt: number;
  status: SupplyStatus;
  unit: string;
  poRefHash: Hex;
  agreementHash: Hex;
  supplierRefHash: Hex;
  supplierAckHash: Hex;
  contractValue: bigint;
  orderedQuantity: bigint;
  deliveredQuantity: bigint;
  protectionId: number;
};

export type ProtectionRequest = {
  id: number;
  supplyRightId: number;
  buyer: Address;
  provider: Address;
  coverageAmount: bigint;
  coverageBps: number;
  expiresAt: number;
  requestedAt: number;
  decidedAt: number;
  status: RequestStatus;
  protectionId: number;
  termsHash: Hex;
  decisionHash: Hex;
};

export type Protection = {
  id: number;
  supplyRightId: number;
  requestId: number;
  provider: Address;
  beneficiary: Address;
  coverageAmount: bigint;
  lockedAmount: bigint;
  paidAmount: bigint;
  releasedAmount: bigint;
  coverageBps: number;
  startsAt: number;
  expiresAt: number;
  claimOpen: boolean;
  status: ProtectionStatus;
  termsHash: Hex;
  /** From the Protection NFT */
  nftClaimStatus: ProtectionClaimStatus;
  nftOwner: Address | null;
};

export type Claim = {
  id: number;
  supplyRightId: number;
  protectionId: number;
  claimant: Address;
  verifier: Address;
  objector: Address;
  claimedType: DefaultType;
  verifiedType: DefaultType;
  status: ClaimStatus;
  submittedAt: number;
  decidedAt: number;
  settledAt: number;
  claimedLoss: bigint;
  reportedDeliveredQuantity: bigint;
  verifiedDeliveredQuantity: bigint;
  approvedLoss: bigint;
  payoutAmount: bigint;
  recoveryTokenId: number;
  evidenceHash: Hex;
  decisionHash: Hex;
  objectionHash: Hex;
};

export type RecoveryClaim = {
  id: number;
  owner: Address;
  supplyRightId: number;
  claimId: number;
  protectionId: number;
  provider: Address;
  compensationAmount: bigint;
  recoveryAmount: bigint;
  recoveredAmount: bigint;
  evidenceHash: Hex;
  decisionHash: Hex;
  settlementRef: Hex;
  lastUpdateHash: Hex;
  settledAt: number;
  settledBlock: number;
  status: RecoveryStatus;
};

export type ProtocolSnapshot = {
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: number;
  supplyRights: SupplyRight[];
  requests: ProtectionRequest[];
  protections: Protection[];
  claims: Claim[];
  recoveries: RecoveryClaim[];
  vault: {
    totalFree: bigint;
    totalLocked: bigint;
    totalPaidOut: bigint;
    /** Native ETH held by the vault at the snapshot block; must be >= totalFree + totalLocked. */
    ethBalance: bigint;
  };
  settings: {
    settlementDelay: number;
    appealWindow: number;
  };
};
