// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {
    SupplyStatus,
    SupplyRightData,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionClaimStatus,
    ClaimRecord,
    ClaimStatus,
    DefaultType,
    RecoveryClaimData,
    RecoveryStatus
} from "./SupplyTypes.sol";
import {
    ISupplyRightNFT,
    ISupplyProtectionVault,
    IRecoveryClaimNFT,
    IClaimReleaseGuard
} from "./interfaces/ISupplyRightProtocol.sol";

/// @title SupplyClaimManager
/// @notice Claim lifecycle for supply-default protection: submission with evidence hashes, independent
///         verification, objection/appeal, and ATOMIC settlement.
///
///         Settlement executes in a single transaction:
///           1. validate the approved claim and remaining coverage
///           2. transfer the eligible compensation from the vault to the beneficiary
///           3. mint the Recovery Claim NFT to the protection provider
///           4. record settlement status and emit events
///         If any step fails the whole transaction reverts.
///
///         Claims are never approved automatically - a passed deadline only makes a claim *fileable*.
///         The verifier, who must be independent of the buyer and the provider, fixes the eligible loss.
contract SupplyClaimManager is AccessControl, ReentrancyGuard, EIP712, IClaimReleaseGuard {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant CLAIM_APPROVAL_TYPEHASH = keccak256(
        "ClaimApproval(uint256 claimId,uint256 verifiedDeliveredQuantity,uint256 approvedLoss,bytes32 decisionHash,address verifier,uint256 nonce,uint256 deadline)"
    );
    uint64 public constant MAX_SETTLEMENT_DELAY = 30 days;
    uint64 public constant MAX_APPEAL_WINDOW = 90 days;
    uint256 public constant MAX_REASON_LENGTH = 512;

    ISupplyRightNFT public immutable supplyRights;
    ISupplyProtectionVault public immutable vault;
    IRecoveryClaimNFT public immutable recoveryNFT;

    /// @notice Minimum time between approval and settlement (objection window for the provider).
    uint64 public settlementDelay;
    /// @notice Time after a rejection during which the claimant may appeal.
    uint64 public appealWindow;

    uint256 public claimCount;
    mapping(uint256 claimId => ClaimRecord) private _claims;
    mapping(uint256 protectionId => uint256 claimId) public activeClaimOf;
    mapping(uint256 protectionId => uint64) public appealDeadlineOf;
    mapping(uint256 supplyRightId => uint256) public cumulativeSettledLoss;
    mapping(uint256 supplyRightId => bool) public hasSettledClaim;
    mapping(uint256 supplyRightId => uint256[]) private _claimsBySupplyRight;
    mapping(bytes32 evidenceHash => bool) public evidenceUsed;
    mapping(address verifier => uint256) public nonces;

    event SettlementDelayUpdated(uint64 delay);
    event AppealWindowUpdated(uint64 window);
    event ClaimSubmitted(
        uint256 indexed claimId,
        uint256 indexed supplyRightId,
        uint256 indexed protectionId,
        address claimant,
        DefaultType claimType,
        uint256 claimedLoss,
        uint256 reportedDeliveredQuantity,
        bytes32 evidenceHash
    );
    event ClaimApproved(
        uint256 indexed claimId,
        address indexed verifier,
        DefaultType verifiedType,
        uint256 verifiedDeliveredQuantity,
        uint256 approvedLoss,
        uint256 payoutAmount,
        bytes32 decisionHash,
        bool viaAttestation
    );
    event ClaimRejected(uint256 indexed claimId, address indexed verifier, bytes32 reasonHash, string reason);
    event ClaimDisputed(uint256 indexed claimId, address indexed objector, bytes32 objectionHash, ClaimStatus previous);
    event ClaimWithdrawn(uint256 indexed claimId, address indexed claimant);
    event ClaimSettled(
        uint256 indexed claimId,
        uint256 indexed supplyRightId,
        uint256 indexed protectionId,
        address beneficiary,
        address provider,
        uint256 payoutAmount,
        uint256 recoveryTokenId,
        bytes32 settlementRef
    );

    error ZeroAddress();
    error ValueTooLarge();
    error UnknownProtection(uint256 protectionId);
    error UnknownClaim(uint256 claimId);
    error NotBeneficiary();
    error NotAuthorized();
    error SupplyRightNotClaimable(SupplyStatus status);
    error DeliveryDeadlineNotReached(uint64 deadline);
    error ClaimAlreadyOpen(uint256 claimId);
    error InvalidEvidence();
    error EvidenceAlreadyUsed();
    error InvalidDefaultType();
    error InvalidDeliveredQuantity();
    error ExcessiveLoss(uint256 requested, uint256 cap);
    error InvalidClaimStatus(ClaimStatus status);
    error VerifierConflict();
    error InvalidDecision();
    error NoCoverageRemaining();
    error SettlementDelayActive(uint64 readyAt);
    error AppealWindowClosed();
    error AlreadyObjected();
    error AttestationExpired();
    error InvalidAttestation();
    error RecoveryMintMismatch();

    constructor(
        address admin,
        ISupplyRightNFT supplyRights_,
        ISupplyProtectionVault vault_,
        IRecoveryClaimNFT recoveryNFT_,
        uint64 settlementDelay_,
        uint64 appealWindow_
    ) EIP712("SupplyRight Claim Manager", "1") {
        if (
            admin == address(0) || address(supplyRights_) == address(0) || address(vault_) == address(0)
                || address(recoveryNFT_) == address(0)
        ) revert ZeroAddress();
        if (settlementDelay_ > MAX_SETTLEMENT_DELAY || appealWindow_ > MAX_APPEAL_WINDOW) revert ValueTooLarge();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        supplyRights = supplyRights_;
        vault = vault_;
        recoveryNFT = recoveryNFT_;
        settlementDelay = settlementDelay_;
        appealWindow = appealWindow_;
        emit SettlementDelayUpdated(settlementDelay_);
        emit AppealWindowUpdated(appealWindow_);
    }

    // ---------------------------------------------------------------------
    // Platform settings (bounded; cannot move funds)
    // ---------------------------------------------------------------------

    function setSettlementDelay(uint64 delay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (delay > MAX_SETTLEMENT_DELAY) revert ValueTooLarge();
        settlementDelay = delay;
        emit SettlementDelayUpdated(delay);
    }

    function setAppealWindow(uint64 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (window > MAX_APPEAL_WINDOW) revert ValueTooLarge();
        appealWindow = window;
        emit AppealWindowUpdated(window);
    }

    // ---------------------------------------------------------------------
    // Buyer: submit / withdraw
    // ---------------------------------------------------------------------

    /// @param claimType Partial (some quantity delivered) or Complete (nothing delivered).
    /// @param claimedLoss Loss the buyer claims, in settlement-token units. The verifier may approve less.
    /// @param reportedDeliveredQuantity Buyer-reported cumulative delivered quantity (3 implied decimals).
    /// @param evidenceHash Hash of the evidence bundle (delivery notes, correspondence, inspection report).
    function submitClaim(
        uint256 protectionId,
        DefaultType claimType,
        uint256 claimedLoss,
        uint256 reportedDeliveredQuantity,
        bytes32 evidenceHash
    ) external nonReentrant returns (uint256 claimId) {
        ProtectionPosition memory p = vault.getProtection(protectionId);
        if (p.status == ProtectionStatus.None) revert UnknownProtection(protectionId);
        if (msg.sender != p.beneficiary) revert NotBeneficiary();
        uint256 open = activeClaimOf[protectionId];
        if (open != 0) revert ClaimAlreadyOpen(open);
        SupplyRightData memory sr = supplyRights.getSupplyRight(p.supplyRightId);
        if (sr.status != SupplyStatus.Active && sr.status != SupplyStatus.Defaulted) {
            revert SupplyRightNotClaimable(sr.status);
        }
        if (block.timestamp <= sr.deliveryDeadline) revert DeliveryDeadlineNotReached(sr.deliveryDeadline);
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (evidenceUsed[evidenceHash]) revert EvidenceAlreadyUsed();
        _validateDefaultType(claimType, reportedDeliveredQuantity, sr.orderedQuantity);
        if (reportedDeliveredQuantity < sr.deliveredQuantity) revert InvalidDeliveredQuantity();
        uint256 cap = remainingLossCap(p.supplyRightId, reportedDeliveredQuantity);
        if (claimedLoss == 0 || claimedLoss > cap) revert ExcessiveLoss(claimedLoss, cap);

        claimId = ++claimCount;
        ClaimRecord storage c = _claims[claimId];
        c.supplyRightId = p.supplyRightId;
        c.protectionId = protectionId;
        c.claimant = msg.sender;
        c.claimedType = claimType;
        c.status = ClaimStatus.Submitted;
        c.submittedAt = uint64(block.timestamp);
        c.claimedLoss = claimedLoss;
        c.reportedDeliveredQuantity = reportedDeliveredQuantity;
        c.evidenceHash = evidenceHash;

        activeClaimOf[protectionId] = claimId;
        appealDeadlineOf[protectionId] = 0;
        evidenceUsed[evidenceHash] = true;
        _claimsBySupplyRight[p.supplyRightId].push(claimId);

        vault.openClaim(protectionId, true);
        supplyRights.setStatusByProtocol(p.supplyRightId, SupplyStatus.UnderAssessment, evidenceHash);
        emit ClaimSubmitted(
            claimId,
            p.supplyRightId,
            protectionId,
            msg.sender,
            claimType,
            claimedLoss,
            reportedDeliveredQuantity,
            evidenceHash
        );
    }

    function withdrawClaim(uint256 claimId) external nonReentrant {
        ClaimRecord storage c = _existing(claimId);
        if (msg.sender != c.claimant) revert NotAuthorized();
        if (c.status != ClaimStatus.Submitted && c.status != ClaimStatus.Approved && c.status != ClaimStatus.Disputed)
        {
            revert InvalidClaimStatus(c.status);
        }
        c.status = ClaimStatus.Withdrawn;
        _closeOpenClaim(c, keccak256(abi.encodePacked("withdrawn", claimId)));
        emit ClaimWithdrawn(claimId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Independent verification
    // ---------------------------------------------------------------------

    /// @notice Approve a claim, fixing the verified delivered quantity and the eligible loss.
    function approveClaim(uint256 claimId, uint256 verifiedDeliveredQuantity, uint256 approvedLoss, bytes32 decisionHash)
        external
        nonReentrant
        onlyRole(VERIFIER_ROLE)
    {
        _approve(claimId, msg.sender, verifiedDeliveredQuantity, approvedLoss, decisionHash, false);
    }

    /// @notice Approve using an EIP-712 attestation signed offchain by an authorized verifier and relayed
    ///         by anyone. Bound to this contract and chain (domain separator), single-use (nonce) and
    ///         time-limited (deadline).
    function approveClaimWithAttestation(
        uint256 claimId,
        uint256 verifiedDeliveredQuantity,
        uint256 approvedLoss,
        bytes32 decisionHash,
        address verifier,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert AttestationExpired();
        if (!hasRole(VERIFIER_ROLE, verifier)) revert NotAuthorized();
        uint256 nonce = nonces[verifier]++;
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_APPROVAL_TYPEHASH,
                    claimId,
                    verifiedDeliveredQuantity,
                    approvedLoss,
                    decisionHash,
                    verifier,
                    nonce,
                    deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(verifier, digest, signature)) revert InvalidAttestation();
        _approve(claimId, verifier, verifiedDeliveredQuantity, approvedLoss, decisionHash, true);
    }

    /// @notice Reject a claim with an explanation (hash of the full report + short public summary).
    function rejectClaim(uint256 claimId, bytes32 reasonHash, string calldata reason)
        external
        nonReentrant
        onlyRole(VERIFIER_ROLE)
    {
        ClaimRecord storage c = _existing(claimId);
        if (c.status != ClaimStatus.Submitted && c.status != ClaimStatus.Disputed) revert InvalidClaimStatus(c.status);
        _checkIndependence(c, msg.sender);
        if (reasonHash == bytes32(0) || bytes(reason).length == 0 || bytes(reason).length > MAX_REASON_LENGTH) {
            revert InvalidDecision();
        }
        c.status = ClaimStatus.Rejected;
        c.verifier = msg.sender;
        c.decisionHash = reasonHash;
        c.decidedAt = uint64(block.timestamp);
        c.approvedLoss = 0;
        c.payoutAmount = 0;
        _closeOpenClaim(c, reasonHash);
        // A first-instance rejection may be appealed once by the claimant.
        if (c.objectionHash == bytes32(0)) {
            appealDeadlineOf[c.protectionId] = uint64(block.timestamp) + appealWindow;
        }
        emit ClaimRejected(claimId, msg.sender, reasonHash, reason);
    }

    // ---------------------------------------------------------------------
    // Objection / appeal
    // ---------------------------------------------------------------------

    /// @notice Raise one objection per claim.
    ///         - Approved claim: the provider or the claimant may object any time before settlement.
    ///         - Rejected claim: the claimant may appeal within `appealWindow`.
    ///         A disputed claim cannot settle until a verifier re-decides it.
    function raiseObjection(uint256 claimId, bytes32 objectionHash) external nonReentrant {
        ClaimRecord storage c = _existing(claimId);
        if (objectionHash == bytes32(0)) revert InvalidDecision();
        if (c.objectionHash != bytes32(0)) revert AlreadyObjected();
        ClaimStatus previous = c.status;

        if (previous == ClaimStatus.Approved) {
            address provider = vault.getProtection(c.protectionId).provider;
            if (msg.sender != provider && msg.sender != c.claimant) revert NotAuthorized();
            vault.setClaimStage(c.protectionId, ProtectionClaimStatus.Disputed);
        } else if (previous == ClaimStatus.Rejected) {
            if (msg.sender != c.claimant) revert NotAuthorized();
            // Only the most recent claim on the supply right, and only within its recorded appeal window.
            uint256[] storage history = _claimsBySupplyRight[c.supplyRightId];
            if (history[history.length - 1] != claimId || block.timestamp > appealDeadlineOf[c.protectionId]) {
                revert AppealWindowClosed();
            }
            uint256 open = activeClaimOf[c.protectionId];
            if (open != 0) revert ClaimAlreadyOpen(open);
            SupplyStatus s = supplyRights.getSupplyRight(c.supplyRightId).status;
            if (s != SupplyStatus.Active && s != SupplyStatus.Defaulted) revert SupplyRightNotClaimable(s);
            activeClaimOf[c.protectionId] = claimId;
            appealDeadlineOf[c.protectionId] = 0;
            // Re-open without the validity check: the claim was filed within the coverage period.
            vault.openClaim(c.protectionId, false);
            vault.setClaimStage(c.protectionId, ProtectionClaimStatus.Disputed);
            supplyRights.setStatusByProtocol(c.supplyRightId, SupplyStatus.UnderAssessment, objectionHash);
        } else {
            revert InvalidClaimStatus(previous);
        }

        c.status = ClaimStatus.Disputed;
        c.objector = msg.sender;
        c.objectionHash = objectionHash;
        emit ClaimDisputed(claimId, msg.sender, objectionHash, previous);
    }

    // ---------------------------------------------------------------------
    // Atomic settlement
    // ---------------------------------------------------------------------

    /// @notice Settle an approved claim. Permissionless: the outcome (amount, beneficiary, recovery
    ///         recipient) is fully determined by onchain state, so anyone may trigger it.
    function settleClaim(uint256 claimId) external nonReentrant returns (uint256 recoveryTokenId) {
        ClaimRecord storage c = _existing(claimId);
        // 1. Validate
        if (c.status != ClaimStatus.Approved) revert InvalidClaimStatus(c.status);
        uint64 readyAt = c.decidedAt + settlementDelay;
        if (block.timestamp < readyAt) revert SettlementDelayActive(readyAt);
        SupplyRightData memory sr = supplyRights.getSupplyRight(c.supplyRightId);
        if (sr.status != SupplyStatus.UnderAssessment) revert SupplyRightNotClaimable(sr.status);
        uint256 cap = remainingLossCap(c.supplyRightId, c.verifiedDeliveredQuantity);
        if (c.approvedLoss > cap) revert ExcessiveLoss(c.approvedLoss, cap);
        ProtectionPosition memory p = vault.getProtection(c.protectionId);
        if (c.payoutAmount > p.lockedAmount || c.payoutAmount > p.coverageAmount - p.paidAmount) {
            revert NoCoverageRemaining();
        }

        recoveryTokenId = recoveryNFT.nextTokenId();
        bytes32 settlementRef = keccak256(abi.encode(block.chainid, address(this), claimId, block.number));

        // Effects
        c.status = ClaimStatus.Settled;
        c.settledAt = uint64(block.timestamp);
        c.recoveryTokenId = recoveryTokenId;
        cumulativeSettledLoss[c.supplyRightId] += c.approvedLoss;
        hasSettledClaim[c.supplyRightId] = true;
        activeClaimOf[c.protectionId] = 0;

        // 2. Transfer compensation from the vault to the beneficiary
        address beneficiary = vault.executePayout(c.protectionId, c.payoutAmount);

        // 3. Mint the Recovery Claim NFT to the provider
        uint256 minted = recoveryNFT.mintRecoveryClaim(
            p.provider,
            RecoveryClaimData({
                supplyRightId: c.supplyRightId,
                claimId: claimId,
                protectionId: c.protectionId,
                provider: p.provider,
                compensationAmount: c.payoutAmount,
                recoveryAmount: c.payoutAmount,
                recoveredAmount: 0,
                evidenceHash: c.evidenceHash,
                decisionHash: c.decisionHash,
                settlementRef: settlementRef,
                lastUpdateHash: bytes32(0),
                settledAt: uint64(block.timestamp),
                settledBlock: uint64(block.number),
                status: RecoveryStatus.Open
            })
        );
        if (minted != recoveryTokenId) revert RecoveryMintMismatch();

        // 4. Record final status
        supplyRights.setStatusByProtocol(c.supplyRightId, SupplyStatus.Defaulted, settlementRef);
        emit ClaimSettled(
            claimId,
            c.supplyRightId,
            c.protectionId,
            beneficiary,
            p.provider,
            c.payoutAmount,
            recoveryTokenId,
            settlementRef
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Remaining loss that may still be recognized for a supply right given a delivered quantity:
    ///         value of the undelivered quantity minus losses already settled.
    function remainingLossCap(uint256 supplyRightId, uint256 deliveredQuantity) public view returns (uint256) {
        uint256 undelivered = supplyRights.undeliveredValue(supplyRightId, deliveredQuantity);
        uint256 settled = cumulativeSettledLoss[supplyRightId];
        return undelivered > settled ? undelivered - settled : 0;
    }

    function isReleaseBlocked(uint256 protectionId) external view returns (bool) {
        return activeClaimOf[protectionId] != 0 || block.timestamp <= appealDeadlineOf[protectionId];
    }

    function getClaim(uint256 claimId) external view returns (ClaimRecord memory) {
        return _claims[claimId];
    }

    function getClaims(uint256 fromId, uint256 count) external view returns (ClaimRecord[] memory out) {
        uint256 last = claimCount;
        if (fromId == 0) fromId = 1;
        if (fromId > last) return new ClaimRecord[](0);
        uint256 n = last - fromId + 1;
        if (n > count) n = count;
        out = new ClaimRecord[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _claims[fromId + i];
        }
    }

    function claimsOfSupplyRight(uint256 supplyRightId) external view returns (uint256[] memory) {
        return _claimsBySupplyRight[supplyRightId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _existing(uint256 claimId) private view returns (ClaimRecord storage c) {
        c = _claims[claimId];
        if (c.status == ClaimStatus.None) revert UnknownClaim(claimId);
    }

    function _approve(
        uint256 claimId,
        address verifier,
        uint256 verifiedDeliveredQuantity,
        uint256 approvedLoss,
        bytes32 decisionHash,
        bool viaAttestation
    ) private {
        ClaimRecord storage c = _existing(claimId);
        if (c.status != ClaimStatus.Submitted && c.status != ClaimStatus.Disputed) revert InvalidClaimStatus(c.status);
        _checkIndependence(c, verifier);
        if (decisionHash == bytes32(0)) revert InvalidDecision();

        SupplyRightData memory sr = supplyRights.getSupplyRight(c.supplyRightId);
        if (verifiedDeliveredQuantity >= sr.orderedQuantity) revert InvalidDeliveredQuantity();
        if (verifiedDeliveredQuantity < sr.deliveredQuantity) revert InvalidDeliveredQuantity();
        uint256 cap = remainingLossCap(c.supplyRightId, verifiedDeliveredQuantity);
        if (cap > c.claimedLoss) cap = c.claimedLoss;
        if (approvedLoss == 0 || approvedLoss > cap) revert ExcessiveLoss(approvedLoss, cap);
        uint256 payout = vault.quotePayout(c.protectionId, approvedLoss);
        if (payout == 0) revert NoCoverageRemaining();

        DefaultType verifiedType = verifiedDeliveredQuantity == 0 ? DefaultType.Complete : DefaultType.Partial;
        c.status = ClaimStatus.Approved;
        c.verifier = verifier;
        c.verifiedType = verifiedType;
        c.verifiedDeliveredQuantity = verifiedDeliveredQuantity;
        c.approvedLoss = approvedLoss;
        c.payoutAmount = payout;
        c.decisionHash = decisionHash;
        c.decidedAt = uint64(block.timestamp);

        if (verifiedDeliveredQuantity > sr.deliveredQuantity) {
            supplyRights.recordDelivery(c.supplyRightId, verifiedDeliveredQuantity, decisionHash);
        }
        vault.setClaimStage(c.protectionId, ProtectionClaimStatus.ClaimApproved);
        emit ClaimApproved(
            claimId, verifier, verifiedType, verifiedDeliveredQuantity, approvedLoss, payout, decisionHash, viaAttestation
        );
    }

    /// @dev Verifier must not be the claimant, the buyer of record, or the protection provider.
    function _checkIndependence(ClaimRecord storage c, address verifier) private view {
        if (verifier == c.claimant) revert VerifierConflict();
        if (verifier == supplyRights.getSupplyRight(c.supplyRightId).buyer) revert VerifierConflict();
        if (verifier == vault.getProtection(c.protectionId).provider) revert VerifierConflict();
    }

    function _closeOpenClaim(ClaimRecord storage c, bytes32 reasonHash) private {
        activeClaimOf[c.protectionId] = 0;
        vault.closeClaim(c.protectionId);
        SupplyStatus next = hasSettledClaim[c.supplyRightId] ? SupplyStatus.Defaulted : SupplyStatus.Active;
        supplyRights.setStatusByProtocol(c.supplyRightId, next, reasonHash);
    }

    function _validateDefaultType(DefaultType claimType, uint256 delivered, uint256 ordered) private pure {
        if (claimType == DefaultType.Complete) {
            if (delivered != 0) revert InvalidDefaultType();
        } else if (claimType == DefaultType.Partial) {
            if (delivered == 0 || delivered >= ordered) revert InvalidDefaultType();
        } else {
            revert InvalidDefaultType();
        }
    }
}
