// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightRoles} from "./lib/SupplyRightRoles.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {
    SupplyStatus,
    SupplyRightData,
    RequestStatus,
    ProtectionRequest,
    ProtectionPosition,
    ProtectionStatus,
    ClaimRecord,
    ClaimStatus,
    DefaultType
} from "../src/SupplyTypes.sol";

/// @notice Real multi-signer end-to-end run of the SupplyRight flow, settled in native ETH. Every step is
///         signed by its own role wallet:
///           1. admin     validates the PO offchain: mints the SupplyRight NFT to the buyer, records the
///                        supplier acknowledgement and the 10 MT delivery note
///           2. buyer     requests protection (0.010 ETH coverage at 20% of verified loss)
///           3. provider  sends 0.010 ETH to the vault escrow and activates the protection (Protection NFT)
///           4. buyer     files a partial-default claim after the delivery deadline (40 of 50 MT missing)
///           5. verifier  verifies the shortfall and approves the eligible loss (0.040 ETH)
///           6. verifier  triggers the atomic settlement: ETH payout to the buyer + Recovery Claim NFT to the
///                        provider in one transaction (settlement is permissionless; the buyer does not pay
///                        gas here, so their balance change equals the payout exactly)
///
///         Resume / no duplicates: the next step is derived from ONCHAIN state of the case identified by
///         E2E_RUN_ID (its PO reference hash), never from a local file. Re-running after a failure continues
///         where the chain stands; a settled claim is only reported, never settled again (the contract would
///         also revert a second settlement).
///
/// Env:
///   E2E_PHASE           setup (steps 1-3) | claim (steps 4-6) | all | status (read-only report)   [all]
///   E2E_RUN_ID          identifies the case; change it to start a fresh case       [SEPOLIA-E2E-001]
///   E2E_DEADLINE_DELAY  seconds from minting until the delivery deadline              [300]
///
/// Sepolia (each forge run asks for the keystore password of every --account it loads):
///   E2E_PHASE=setup forge script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --rpc-url sepolia --broadcast --slow \
///     --account supplyright-admin --account supplyright-buyer --account supplyright-provider
///   E2E_PHASE=claim forge script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --rpc-url sepolia --broadcast --slow \
///     --account supplyright-buyer --account supplyright-verifier
///   E2E_PHASE=status forge script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --rpc-url sepolia
contract RunSepoliaE2E is ScriptBase {
    uint256 internal constant MT = 1e3; // quantities carry 3 implied decimals
    uint256 internal constant ORDERED = 50 * MT;
    uint256 internal constant DELIVERED = 10 * MT;
    uint256 internal constant CONTRACT_VALUE = 0.05 ether; // 0.001 ETH per MT
    uint256 internal constant COVERAGE = 0.010 ether;
    uint16 internal constant COVERAGE_BPS = 2_000; // 20% of the verified loss
    uint256 internal constant CLAIMED_LOSS = 0.040 ether; // 40 MT undelivered x 0.001 ETH
    uint256 internal constant TARGET_PAYOUT = 0.008 ether; // the scenario's expectation, checked not enforced
    uint256 internal constant TARGET_REMAINING = 0.002 ether;

    SupplyRightRoles.Protocol internal p;
    SupplyRightRoles.Wallets internal w;
    string internal runId;

    function run() external {
        string memory phase = vm.envOr("E2E_PHASE", string("all"));
        runId = vm.envOr("E2E_RUN_ID", string("SEPOLIA-E2E-001"));
        p = _protocol();
        w = _roleWallets();
        bool readOnly = _eq(phase, "status");
        bool doSetup = readOnly ? false : (_eq(phase, "setup") || _eq(phase, "all"));
        bool doClaim = readOnly ? false : (_eq(phase, "claim") || _eq(phase, "all"));
        require(readOnly || doSetup || doClaim, "E2E_PHASE must be setup | claim | all | status");

        console2.log("=== SupplyRight E2E, chain", block.chainid);
        console2.log("    run id:", runId);
        console2.log("    phase :", phase);
        _requireRoleMatrix(p, w);

        uint256 rightId = p.rights.tokenIdByPoRef(_ref("PO"));
        if (doSetup) rightId = _registerPurchaseOrder(rightId);
        if (rightId == 0) {
            console2.log("no supply right for this run id yet; run E2E_PHASE=setup");
            return;
        }
        _assertRight(rightId);

        uint256 protectionId = p.rights.getSupplyRight(rightId).protectionId;
        if (doSetup && protectionId == 0) protectionId = _fundProtection(rightId);
        if (protectionId == 0) {
            _report(rightId, 0, 0, "protection not active yet; run E2E_PHASE=setup");
            return;
        }
        _assertProtection(rightId, protectionId);

        uint256 claimId = _latestClaim(rightId);
        if (claimId != 0) _assertClaim(rightId, protectionId, claimId);
        if (doClaim) {
            if (claimId == 0) claimId = _fileClaim(rightId, protectionId);
            if (claimId != 0) _assertClaim(rightId, protectionId, claimId);
            if (claimId != 0 && p.claims.getClaim(claimId).status == ClaimStatus.Submitted) _verify(claimId);
            if (claimId != 0 && p.claims.getClaim(claimId).status == ClaimStatus.Approved) _settle(claimId);
        }
        _report(rightId, protectionId, claimId, "");
    }

    // ---------------------------------------------------------------------
    // Steps
    // ---------------------------------------------------------------------

    /// Step 1 - admin (REGISTRAR_ROLE): mint to the buyer, supplier acknowledgement, delivery note.
    function _registerPurchaseOrder(uint256 rightId) private returns (uint256) {
        if (rightId == 0) {
            uint64 deadline = uint64(block.timestamp + vm.envOr("E2E_DEADLINE_DELAY", uint256(300)));
            console2.log("[1] admin mints the SupplyRight NFT to the buyer; delivery deadline", deadline);
            _startBroadcastAs(Role.Admin);
            rightId = p.rights.mintSupplyRight(
                SupplyRightNFT.MintParams({
                    buyer: w.buyer,
                    poRefHash: _ref("PO"),
                    agreementHash: _ref("SUPPLY-AGREEMENT"),
                    supplierRefHash: _ref("SUPPLIER"),
                    contractValue: CONTRACT_VALUE,
                    orderedQuantity: ORDERED,
                    deliveryDeadline: deadline,
                    unit: bytes8("MT")
                })
            );
            vm.stopBroadcast();
        } else {
            _assertRight(rightId);
        }
        SupplyRightData memory sr = p.rights.getSupplyRight(rightId);
        if (sr.status == SupplyStatus.Registered) {
            console2.log("[1] admin records the supplier acknowledgement (Registered -> Active)");
            _startBroadcastAs(Role.Admin);
            p.rights.activate(rightId, _ref("SUPPLIER-ACK"));
            vm.stopBroadcast();
        }
        if (p.rights.getSupplyRight(rightId).deliveredQuantity < DELIVERED) {
            require(
                p.rights.getSupplyRight(rightId).status == SupplyStatus.Active,
                "E2E delivery note cannot be added after claim processing"
            );
            console2.log("[1] admin records the delivery note: 10 of 50 MT delivered");
            _startBroadcastAs(Role.Admin);
            p.rights.recordDelivery(rightId, DELIVERED, _ref("DELIVERY-NOTE-1"));
            vm.stopBroadcast();
        }
        console2.log("    SupplyRight NFT #", rightId);
        return rightId;
    }

    /// Steps 2-3 - buyer requests protection; provider sends the ETH escrow and activates it.
    function _fundProtection(uint256 rightId) private returns (uint256 protectionId) {
        uint256 requestId = p.vault.pendingRequestOf(rightId);
        if (requestId == 0) {
            uint64 expiry = p.rights.getSupplyRight(rightId).deliveryDeadline + 30 days;
            console2.log("[2] buyer requests 0.010 ETH protection at 20% from the provider");
            _startBroadcastAs(Role.Buyer);
            requestId = p.vault.requestProtection(rightId, w.provider, COVERAGE, COVERAGE_BPS, expiry, _ref("TERMS"));
            vm.stopBroadcast();
        }
        _assertRequest(rightId, requestId);
        uint256 free = p.vault.freeCollateral(w.provider);
        uint256 escrow = COVERAGE > free ? COVERAGE - free : 0;
        console2.log("[3] provider sends ETH escrow to the vault and activates protection, wei:", escrow);
        _startBroadcastAs(Role.Provider);
        protectionId = p.vault.fundAndApproveProtection{value: escrow}(requestId, _ref("UNDERWRITING"));
        vm.stopBroadcast();
        console2.log("    Protection NFT #", protectionId);
    }

    /// Step 4 - buyer files the claim, only once the delivery deadline has passed.
    function _fileClaim(uint256 rightId, uint256 protectionId) private returns (uint256 claimId) {
        uint64 deadline = p.rights.getSupplyRight(rightId).deliveryDeadline;
        if (block.timestamp <= deadline) {
            console2.log("[4] delivery deadline not reached; seconds left:", deadline - block.timestamp + 1);
            return 0;
        }
        console2.log("[4] buyer files a partial-default claim: 40 MT missing, loss 0.040 ETH");
        _startBroadcastAs(Role.Buyer);
        claimId = p.claims.submitClaim(protectionId, DefaultType.Partial, CLAIMED_LOSS, DELIVERED, _ref("EVIDENCE"));
        vm.stopBroadcast();
        console2.log("    claim #", claimId);
    }

    /// Step 5 - independent verifier approves the verified loss.
    function _verify(uint256 claimId) private {
        console2.log("[5] verifier confirms 10 MT delivered and approves the 0.040 ETH loss");
        _startBroadcastAs(Role.Verifier);
        p.claims.approveClaim(claimId, DELIVERED, CLAIMED_LOSS, _ref("VERIFIER-REPORT"));
        vm.stopBroadcast();
    }

    /// Step 6 - atomic settlement, sent at most once (guarded by the onchain claim status).
    function _settle(uint256 claimId) private {
        uint64 readyAt = p.claims.getClaim(claimId).decidedAt + p.claims.settlementDelay();
        if (block.timestamp < readyAt) {
            console2.log("[6] settlement delay active; settle after unix time", readyAt);
            return;
        }
        console2.log("[6] atomic settlement: ETH payout to buyer + Recovery Claim NFT to provider");
        _startBroadcastAs(Role.Verifier);
        uint256 recoveryId = p.claims.settleClaim(claimId);
        vm.stopBroadcast();
        console2.log("    Recovery Claim NFT #", recoveryId);
    }

    // ---------------------------------------------------------------------
    // Report (onchain state; in a broadcast run this reflects the simulated end state)
    // ---------------------------------------------------------------------

    function _report(uint256 rightId, uint256 protectionId, uint256 claimId, string memory note) private view {
        console2.log("");
        console2.log("--- state ---");
        console2.log("SupplyRight NFT #", rightId, "owner", p.rights.ownerOf(rightId));
        console2.log("  status:", p.rights.statusName(p.rights.getSupplyRight(rightId).status));
        _balance("buyer   ", w.buyer);
        _balance("provider", w.provider);
        _balance("verifier", w.verifier);
        _balance("admin   ", w.admin);
        _balance("vault   ", address(p.vault));
        console2.log("vault free / locked (wei):", p.vault.totalFreeCollateral(), p.vault.totalLockedCollateral());
        if (protectionId != 0) {
            ProtectionPosition memory pos = p.vault.getProtection(protectionId);
            console2.log("Protection NFT #", protectionId, "owner", p.protection.ownerOf(protectionId));
            console2.log("  escrow locked / paid (ETH):", _eth(pos.lockedAmount), _eth(pos.paidAmount));
        }
        if (claimId != 0) {
            ClaimRecord memory c = p.claims.getClaim(claimId);
            console2.log("Claim #", claimId, "status", _claimStatus(c.status));
            console2.log("  approved loss / payout (ETH):", _eth(c.approvedLoss), _eth(c.payoutAmount));
            if (c.status == ClaimStatus.Settled) {
                address holder = p.recovery.ownerOf(c.recoveryTokenId);
                console2.log("Recovery Claim NFT #", c.recoveryTokenId, "owner", holder);
                require(holder == w.provider, "recovery NFT must belong to the provider");
                uint256 remaining = p.vault.getProtection(protectionId).lockedAmount;
                console2.log(
                    c.payoutAmount == TARGET_PAYOUT && remaining == TARGET_REMAINING
                        ? "Economics match the scenario: 0.008 ETH paid to buyer, 0.002 ETH stays locked"
                        : "NOTE: contract economics differ from the 0.008 / 0.002 scenario (contract rules apply)"
                );
            }
        }
        if (bytes(note).length != 0) console2.log(note);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev A run id is public. Reject an existing PO whose economic terms or document references do not
    ///      match this scenario before the admin, buyer, or provider signs another transaction.
    function _assertRight(uint256 rightId) private view {
        SupplyRightData memory sr = p.rights.getSupplyRight(rightId);
        require(sr.buyer == w.buyer, "E2E PO buyer differs from this run");
        require(sr.poRefHash == _ref("PO"), "E2E PO reference differs from this run");
        require(sr.agreementHash == _ref("SUPPLY-AGREEMENT"), "E2E agreement differs from this run");
        require(sr.supplierRefHash == _ref("SUPPLIER"), "E2E supplier differs from this run");
        require(sr.contractValue == CONTRACT_VALUE && sr.orderedQuantity == ORDERED, "E2E PO economics differ");
        require(sr.unit == bytes8("MT"), "E2E PO unit differs from this run");
        require(sr.deliveredQuantity <= DELIVERED, "E2E delivery exceeds this run's report");
        if (sr.status != SupplyStatus.Registered) {
            require(sr.supplierAckHash == _ref("SUPPLIER-ACK"), "E2E supplier acknowledgement differs");
        }
    }

    function _assertRequest(uint256 rightId, uint256 requestId) private view {
        ProtectionRequest memory r = p.vault.getRequest(requestId);
        require(r.status == RequestStatus.Pending, "E2E protection request is no longer pending");
        require(r.supplyRightId == rightId && r.buyer == w.buyer, "E2E protection request belongs to another PO");
        require(r.provider == w.provider, "E2E protection request designates another provider");
        require(r.coverageAmount == COVERAGE && r.coverageBps == COVERAGE_BPS, "E2E protection terms differ");
        require(r.termsHash == _ref("TERMS"), "E2E protection document differs");
        require(r.expiresAt == p.rights.getSupplyRight(rightId).deliveryDeadline + 30 days, "E2E expiry differs");
    }

    function _assertProtection(uint256 rightId, uint256 protectionId) private view {
        ProtectionPosition memory pos = p.vault.getProtection(protectionId);
        require(pos.supplyRightId == rightId && pos.beneficiary == w.buyer, "E2E protection beneficiary differs");
        require(pos.provider == w.provider, "E2E protection provider differs");
        require(pos.coverageAmount == COVERAGE && pos.coverageBps == COVERAGE_BPS, "E2E coverage differs");
        require(pos.termsHash == _ref("TERMS"), "E2E funded protection document differs");
        require(pos.expiresAt == p.rights.getSupplyRight(rightId).deliveryDeadline + 30 days, "E2E funded expiry differs");
        require(pos.status != ProtectionStatus.None, "E2E protection is missing");
    }

    function _assertClaim(uint256 rightId, uint256 protectionId, uint256 claimId) private view {
        ClaimRecord memory c = p.claims.getClaim(claimId);
        require(c.supplyRightId == rightId && c.protectionId == protectionId, "E2E claim belongs to another case");
        require(c.claimant == w.buyer, "E2E claim was filed by another buyer");
        require(c.claimedType == DefaultType.Partial, "E2E claim type differs");
        require(c.claimedLoss == CLAIMED_LOSS && c.reportedDeliveredQuantity == DELIVERED, "E2E claim loss differs");
        require(c.evidenceHash == _ref("EVIDENCE"), "E2E claim evidence differs");
        if (c.status == ClaimStatus.Approved || c.status == ClaimStatus.Settled) {
            require(c.verifier == w.verifier, "E2E claim was decided by another verifier");
            require(
                c.verifiedDeliveredQuantity == DELIVERED && c.approvedLoss == CLAIMED_LOSS,
                "E2E verified loss differs"
            );
        }
    }

    function _latestClaim(uint256 rightId) private view returns (uint256) {
        uint256[] memory ids = p.claims.claimsOfSupplyRight(rightId);
        return ids.length == 0 ? 0 : ids[ids.length - 1];
    }

    function _ref(string memory label) private view returns (bytes32) {
        return keccak256(abi.encodePacked("SupplyRight/", runId, "/", label));
    }

    function _balance(string memory label, address a) private view {
        console2.log(string.concat(label, " ", vm.toString(a), "  ", _eth(a.balance), " ETH"));
    }

    function _claimStatus(ClaimStatus s) private pure returns (string memory) {
        if (s == ClaimStatus.Submitted) return "Submitted";
        if (s == ClaimStatus.Approved) return "Approved";
        if (s == ClaimStatus.Rejected) return "Rejected";
        if (s == ClaimStatus.Disputed) return "Disputed";
        if (s == ClaimStatus.Settled) return "Settled";
        if (s == ClaimStatus.Withdrawn) return "Withdrawn";
        return "None";
    }

    /// @dev 8000000000000000 -> "0.008"
    function _eth(uint256 amount) internal pure returns (string memory) {
        string memory frac = vm.toString(amount % 1 ether + 1 ether); // "1" + 18 digits keeps leading zeros
        bytes memory f = bytes(frac);
        uint256 end = f.length;
        while (end > 2 && f[end - 1] == "0") end--;
        bytes memory digits = new bytes(end - 1);
        for (uint256 i = 1; i < end; i++) {
            digits[i - 1] = f[i];
        }
        string memory whole = vm.toString(amount / 1 ether);
        return end == 2 && f[1] == "0" ? whole : string.concat(whole, ".", string(digits));
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
