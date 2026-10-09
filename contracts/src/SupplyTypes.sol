// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Lifecycle of a tokenized supply right.
enum SupplyStatus {
    Registered, // minted by a registrar after the agreement documents were verified offchain
    Active, // supplier acknowledgement recorded; delivery obligations are running
    Fulfilled, // full delivery confirmed
    UnderAssessment, // a default claim is being assessed
    Defaulted, // at least one verified default has been settled
    Closed // final; no further claims or protection changes
}

enum RequestStatus {
    None,
    Pending,
    Approved,
    Rejected,
    Cancelled
}

enum ProtectionStatus {
    None,
    Active, // collateral locked, coverage available
    Exhausted, // coverage fully paid out
    Released // remaining collateral returned to the provider's free balance
}

/// @notice Claim-facing status mirrored on the Protection NFT.
enum ProtectionClaimStatus {
    NoClaim,
    ClaimPending,
    ClaimApproved,
    Disputed,
    PartiallyPaid,
    Exhausted,
    Released
}

enum ClaimStatus {
    None,
    Submitted,
    Approved,
    Rejected,
    Disputed,
    Settled,
    Withdrawn
}

enum DefaultType {
    None,
    Partial, // some quantity delivered, shortfall remains
    Complete // nothing delivered
}

enum RecoveryStatus {
    Open,
    InRecovery,
    PartiallyRecovered,
    Recovered,
    WrittenOff
}

/// @dev Monetary values are denominated in the settlement token's smallest unit (18 decimals for mETH).
///      Quantities are stored with 3 implied decimals (e.g. 50 MT = 50_000).
struct SupplyRightData {
    address buyer;
    uint64 deliveryDeadline;
    uint64 registeredAt;
    SupplyStatus status;
    bytes8 unit;
    bytes32 poRefHash;
    bytes32 agreementHash;
    bytes32 supplierRefHash;
    bytes32 supplierAckHash;
    uint256 contractValue;
    uint256 orderedQuantity;
    uint256 deliveredQuantity;
    uint256 protectionId;
}

struct ProtectionRequest {
    uint256 supplyRightId;
    address buyer;
    address provider; // address(0) = open to any authorized provider
    uint256 coverageAmount;
    uint16 coverageBps;
    uint64 expiresAt;
    uint64 requestedAt;
    uint64 decidedAt;
    RequestStatus status;
    uint256 protectionId;
    bytes32 termsHash;
    bytes32 decisionHash;
}

/// @notice Escrow accounting for one funded protection agreement held by the vault.
struct ProtectionPosition {
    uint256 supplyRightId;
    uint256 requestId;
    address provider;
    address beneficiary;
    uint256 coverageAmount;
    uint256 lockedAmount;
    uint256 paidAmount;
    uint256 releasedAmount;
    uint16 coverageBps;
    uint64 startsAt;
    uint64 expiresAt;
    bool claimOpen;
    ProtectionStatus status;
    bytes32 termsHash;
}

/// @notice Descriptive terms recorded on the Protection NFT.
struct ProtectionTerms {
    uint256 supplyRightId;
    address provider;
    address beneficiary;
    uint256 coverageAmount;
    uint16 coverageBps;
    uint64 startsAt;
    uint64 expiresAt;
    bytes32 termsHash;
    address escrowVault;
    uint256 escrowId;
    ProtectionClaimStatus claimStatus;
}

struct ClaimRecord {
    uint256 supplyRightId;
    uint256 protectionId;
    address claimant;
    address verifier;
    address objector;
    DefaultType claimedType;
    DefaultType verifiedType;
    ClaimStatus status;
    uint64 submittedAt;
    uint64 decidedAt;
    uint64 settledAt;
    uint256 claimedLoss;
    uint256 reportedDeliveredQuantity;
    uint256 verifiedDeliveredQuantity;
    uint256 approvedLoss;
    uint256 payoutAmount;
    uint256 recoveryTokenId;
    bytes32 evidenceHash;
    bytes32 decisionHash;
    bytes32 objectionHash;
}

struct RecoveryClaimData {
    uint256 supplyRightId;
    uint256 claimId;
    uint256 protectionId;
    address provider;
    uint256 compensationAmount;
    uint256 recoveryAmount;
    uint256 recoveredAmount;
    bytes32 evidenceHash;
    bytes32 decisionHash;
    bytes32 settlementRef;
    bytes32 lastUpdateHash;
    uint64 settledAt;
    uint64 settledBlock;
    RecoveryStatus status;
}
