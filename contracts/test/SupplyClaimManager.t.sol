// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SupplyRightFixture} from "./Fixture.t.sol";
import {EtherRejecter} from "./utils/EtherRejecter.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {RestrictedTransfer721} from "../src/base/RestrictedTransfer721.sol";
import {
    SupplyStatus,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionClaimStatus,
    ClaimRecord,
    ClaimStatus,
    DefaultType,
    RecoveryClaimData,
    RecoveryStatus
} from "../src/SupplyTypes.sol";

contract SupplyClaimManagerTest is SupplyRightFixture {
    // ------------------------------------------------------------------
    // Mandatory end-to-end case study
    // ------------------------------------------------------------------

    function test_EndToEnd_PartialDefaultCaseStudy() public {
        // 1-2. Register + mint + activate the supply right (50 MT, 100 ETH).
        uint256 rightId = _mintActiveRight();
        // 3-4. Provider deposits 20 ETH and the Protection NFT is minted.
        uint256 pid = _protect(rightId);
        assertEq(address(vault).balance, COVERAGE);

        // 6. Only 10 MT delivered; buyer files a partial-default claim after the deadline.
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.UnderAssessment));
        assertEq(uint8(protection.getTerms(pid).claimStatus), uint8(ProtectionClaimStatus.ClaimPending));

        // 7. Independent verifier confirms 10 MT delivered and an eligible loss of 80 ETH.
        _approve(claimId, DELIVERED, SHORTFALL_LOSS);
        ClaimRecord memory c = claims.getClaim(claimId);
        assertEq(uint8(c.status), uint8(ClaimStatus.Approved));
        assertEq(uint8(c.verifiedType), uint8(DefaultType.Partial));
        assertEq(c.payoutAmount, EXPECTED_PAYOUT); // 20% x 80 = 16 ETH
        assertEq(recovery.totalMinted(), 0, "no recovery NFT before settlement");

        // 8-9. Atomic settlement: 16 ETH to buyer + Recovery Claim NFT to provider in one tx.
        uint256 buyerBefore = buyer.balance;
        vm.expectEmit(true, true, true, false, address(claims));
        emit SupplyClaimManager.ClaimSettled(claimId, rightId, pid, buyer, provider, EXPECTED_PAYOUT, 1, bytes32(0));
        vm.prank(outsider); // permissionless trigger; outcome fixed by onchain state
        uint256 recoveryId = claims.settleClaim(claimId);

        assertEq(buyer.balance, buyerBefore + EXPECTED_PAYOUT);
        assertEq(outsider.balance, 0);
        assertEq(recovery.ownerOf(recoveryId), provider);
        RecoveryClaimData memory rc = recovery.getRecoveryClaim(recoveryId);
        assertEq(rc.claimId, claimId);
        assertEq(rc.supplyRightId, rightId);
        assertEq(rc.compensationAmount, EXPECTED_PAYOUT);
        assertEq(rc.recoveryAmount, EXPECTED_PAYOUT);
        assertEq(rc.evidenceHash, c.evidenceHash);
        assertTrue(rc.settlementRef != bytes32(0));
        assertEq(uint8(rc.status), uint8(RecoveryStatus.Open));

        // 10. 4 ETH coverage commitment remains locked.
        ProtectionPosition memory p = vault.getProtection(pid);
        assertEq(p.lockedAmount, 4 * ETH);
        assertEq(p.paidAmount, EXPECTED_PAYOUT);
        assertEq(vault.totalLockedCollateral(), 4 * ETH);
        assertEq(vault.totalPaidOut(), EXPECTED_PAYOUT);
        assertEq(address(vault).balance, 4 * ETH);

        // 11. Onchain state is consistent.
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Settled));
        assertEq(claims.getClaim(claimId).recoveryTokenId, recoveryId);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.Defaulted));
        assertEq(rights.getSupplyRight(rightId).deliveredQuantity, DELIVERED);
        assertEq(uint8(protection.getTerms(pid).claimStatus), uint8(ProtectionClaimStatus.PartiallyPaid));
        assertEq(claims.cumulativeSettledLoss(rightId), SHORTFALL_LOSS);
    }

    function test_CompleteDefaultExhaustsCoverage() public {
        (uint256 rightId, uint256 pid) = _setupProtected();
        _passDeadline();
        vm.prank(buyer);
        uint256 claimId = claims.submitClaim(pid, DefaultType.Complete, CONTRACT_VALUE, 0, _evidence());
        _approve(claimId, 0, CONTRACT_VALUE);
        assertEq(uint8(claims.getClaim(claimId).verifiedType), uint8(DefaultType.Complete));
        assertEq(claims.getClaim(claimId).payoutAmount, COVERAGE); // min(20% x 100, 20)

        claims.settleClaim(claimId);
        ProtectionPosition memory p = vault.getProtection(pid);
        assertEq(p.lockedAmount, 0);
        assertEq(uint8(p.status), uint8(ProtectionStatus.Exhausted));
        assertEq(uint8(protection.getTerms(pid).claimStatus), uint8(ProtectionClaimStatus.Exhausted));
        assertEq(buyer.balance, COVERAGE);

        // Exhausted protection cannot accept further claims.
        vm.prank(buyer);
        vm.expectRevert();
        claims.submitClaim(pid, DefaultType.Complete, 1, 0, _evidence());
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.Defaulted));
    }

    // ------------------------------------------------------------------
    // Authorization & independence
    // ------------------------------------------------------------------

    function test_RevertWhen_UnauthorizedVerification() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        bytes32 role = claims.VERIFIER_ROLE();

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, role));
        vm.prank(outsider);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"));

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, buyer, role));
        vm.prank(buyer);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"));

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, role));
        vm.prank(outsider);
        claims.rejectClaim(claimId, keccak256("r"), "no");
    }

    function test_RevertWhen_BuyerHoldsVerifierRoleAndApprovesOwnClaim() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        bytes32 role = claims.VERIFIER_ROLE();
        vm.startPrank(admin);
        claims.grantRole(role, buyer);
        claims.grantRole(role, provider);
        vm.stopPrank();

        vm.expectRevert(SupplyClaimManager.VerifierConflict.selector);
        vm.prank(buyer);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"));

        vm.expectRevert(SupplyClaimManager.VerifierConflict.selector);
        vm.prank(provider);
        claims.rejectClaim(claimId, keccak256("r"), "provider cannot judge its own exposure");
    }

    function test_RevertWhen_NonBeneficiarySubmits() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        vm.expectRevert(SupplyClaimManager.NotBeneficiary.selector);
        vm.prank(provider);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS, DELIVERED, keccak256("e"));
    }

    function test_OnlyClaimManagerMintsRecoveryNFT() public {
        RecoveryClaimData memory d;
        vm.expectRevert(RecoveryClaimNFT.NotClaimManager.selector);
        vm.prank(admin);
        recovery.mintRecoveryClaim(admin, d);
    }

    // ------------------------------------------------------------------
    // Claim validation
    // ------------------------------------------------------------------

    function test_RevertWhen_ClaimBeforeDeadline() public {
        (, uint256 pid) = _setupProtected();
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.DeliveryDeadlineNotReached.selector, deadline));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS, DELIVERED, keccak256("e"));
    }

    function test_RevertWhen_ProtectionExpired() public {
        (, uint256 pid) = _setupProtected();
        vm.warp(protectionExpiry + 1);
        vm.expectRevert();
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS, DELIVERED, keccak256("e"));
    }

    function test_RevertWhen_DefaultTypeInconsistent() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        vm.startPrank(buyer);
        vm.expectRevert(SupplyClaimManager.InvalidDefaultType.selector);
        claims.submitClaim(pid, DefaultType.Complete, SHORTFALL_LOSS, DELIVERED, keccak256("e1"));
        vm.expectRevert(SupplyClaimManager.InvalidDefaultType.selector);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS, 0, keccak256("e2"));
        vm.expectRevert(SupplyClaimManager.InvalidDefaultType.selector);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS, ORDERED, keccak256("e3"));
        vm.stopPrank();
    }

    function test_RevertWhen_ExcessiveCompensationRequested() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        // Claimed loss above the value of undelivered goods.
        vm.expectRevert(
            abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, SHORTFALL_LOSS + 1, SHORTFALL_LOSS)
        );
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, SHORTFALL_LOSS + 1, DELIVERED, keccak256("e"));

        // Verifier cannot approve more than claimed, nor more than the verified shortfall.
        uint256 claimId = _submitPartial(pid, DELIVERED, 50 * ETH);
        vm.startPrank(verifier);
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, 50 * ETH + 1, 50 * ETH));
        claims.approveClaim(claimId, DELIVERED, 50 * ETH + 1, keccak256("r"));
        // With 30 MT verified as delivered, only 40 ETH of loss is recognizable.
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, 50 * ETH, 40 * ETH));
        claims.approveClaim(claimId, 30 * MT, 50 * ETH, keccak256("r"));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Double claims / double payouts
    // ------------------------------------------------------------------

    function test_DuplicateClaimsCannotProduceDuplicatePayouts() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedDemoClaim();

        // Second claim while one is open.
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ClaimAlreadyOpen.selector, claimId));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1 * ETH, DELIVERED, keccak256("other-evidence"));

        claims.settleClaim(claimId);

        // Settling twice.
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Settled));
        claims.settleClaim(claimId);

        // Re-using the same evidence bundle.
        bytes32 used = claims.getClaim(claimId).evidenceHash;
        vm.expectRevert(SupplyClaimManager.EvidenceAlreadyUsed.selector);
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1 * ETH, DELIVERED, used);

        // Re-claiming the same 40 MT shortfall with fresh evidence: loss cap is already consumed.
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, 1 * ETH, 0));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1 * ETH, DELIVERED, keccak256("fresh"));

        assertEq(buyer.balance, EXPECTED_PAYOUT);
        assertEq(recovery.totalMinted(), 1);
        assertEq(claims.remainingLossCap(rightId, DELIVERED), 0);
    }

    function test_PartialClaimsReduceRemainingCoverage() public {
        (uint256 rightId, uint256 pid) = _setupProtected();
        _passDeadline();

        // Claim 1: 30 ETH loss recognized -> 6 ETH payout.
        uint256 c1 = _submitPartial(pid, DELIVERED, 30 * ETH);
        _approve(c1, DELIVERED, 30 * ETH);
        claims.settleClaim(c1);
        assertEq(vault.getProtection(pid).lockedAmount, 14 * ETH);
        assertEq(claims.remainingLossCap(rightId, DELIVERED), 50 * ETH);

        // Claim 2: further 50 ETH loss -> 10 ETH payout; 4 ETH remains.
        uint256 c2 = _submitPartial(pid, DELIVERED, 50 * ETH);
        _approve(c2, DELIVERED, 50 * ETH);
        claims.settleClaim(c2);

        ProtectionPosition memory p = vault.getProtection(pid);
        assertEq(p.paidAmount, 16 * ETH);
        assertEq(p.lockedAmount, 4 * ETH);
        assertEq(buyer.balance, 16 * ETH);
        assertEq(recovery.totalMinted(), 2);
        assertEq(claims.cumulativeSettledLoss(rightId), SHORTFALL_LOSS);
    }

    function test_PayoutCappedByRemainingCoverage() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        // 90% coverage on an 80 ETH loss would be 72 ETH, but only 20 ETH is funded.
        uint256 c1 = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        _approve(c1, DELIVERED, SHORTFALL_LOSS);
        assertEq(claims.getClaim(c1).payoutAmount, EXPECTED_PAYOUT);
        assertLe(vault.quotePayout(pid, type(uint128).max), COVERAGE);
    }

    // ------------------------------------------------------------------
    // Rejection, objection, appeal
    // ------------------------------------------------------------------

    function test_RejectedClaimCannotSettle() public {
        (uint256 rightId, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);

        vm.expectEmit(true, true, false, true, address(claims));
        emit SupplyClaimManager.ClaimRejected(claimId, verifier, keccak256("report"), "Delivery notes inconsistent");
        vm.prank(verifier);
        claims.rejectClaim(claimId, keccak256("report"), "Delivery notes inconsistent");

        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Rejected));
        claims.settleClaim(claimId);
        assertEq(buyer.balance, 0);
        assertEq(recovery.totalMinted(), 0);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.Active));
        assertEq(vault.getProtection(pid).lockedAmount, COVERAGE);
    }

    function test_RevertWhen_RejectingWithoutExplanation() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.expectRevert(SupplyClaimManager.InvalidDecision.selector);
        vm.prank(verifier);
        claims.rejectClaim(claimId, keccak256("report"), "");
    }

    function test_ProviderObjectionBlocksSettlementUntilReDecided() public {
        (,, uint256 claimId) = _approvedDemoClaim();
        vm.prank(provider);
        claims.raiseObjection(claimId, keccak256("provider-objection"));
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Disputed));

        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Disputed));
        claims.settleClaim(claimId);

        // Only one objection per claim.
        vm.expectRevert(SupplyClaimManager.AlreadyObjected.selector);
        vm.prank(buyer);
        claims.raiseObjection(claimId, keccak256("buyer-objection"));

        // Verifier re-decides with a lower eligible loss: 60 ETH -> 12 ETH payout.
        _approve(claimId, DELIVERED, 60 * ETH);
        claims.settleClaim(claimId);
        assertEq(buyer.balance, 12 * ETH);
    }

    function test_RevertWhen_OutsiderObjects() public {
        (,, uint256 claimId) = _approvedDemoClaim();
        vm.expectRevert(SupplyClaimManager.NotAuthorized.selector);
        vm.prank(outsider);
        claims.raiseObjection(claimId, keccak256("x"));
    }

    function test_BuyerAppealOfRejection() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.prank(verifier);
        claims.rejectClaim(claimId, keccak256("report"), "Missing inspection report");

        // Collateral release is blocked while the rejection is appealable.
        vm.warp(protectionExpiry + 1);
        assertTrue(claims.isReleaseBlocked(pid) == (block.timestamp <= claims.appealDeadlineOf(pid)));

        vm.warp(claims.getClaim(claimId).decidedAt + 1 days);
        vm.prank(buyer);
        claims.raiseObjection(claimId, keccak256("appeal-with-inspection-report"));
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Disputed));
        assertTrue(claims.isReleaseBlocked(pid));

        _approve(claimId, DELIVERED, SHORTFALL_LOSS);
        claims.settleClaim(claimId);
        assertEq(buyer.balance, EXPECTED_PAYOUT);
    }

    function test_RevertWhen_AppealAfterWindow() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.prank(verifier);
        claims.rejectClaim(claimId, keccak256("report"), "Missing inspection report");
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(SupplyClaimManager.AppealWindowClosed.selector);
        vm.prank(buyer);
        claims.raiseObjection(claimId, keccak256("late"));
        assertFalse(claims.isReleaseBlocked(pid));
    }

    function test_WithdrawClaimReopensSupplyRight() public {
        (uint256 rightId, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.prank(buyer);
        claims.withdrawClaim(claimId);
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Withdrawn));
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.Active));
        assertEq(claims.activeClaimOf(pid), 0);
    }

    function test_SettlementDelayEnforced() public {
        vm.prank(admin);
        claims.setSettlementDelay(1 days);
        (,, uint256 claimId) = _approvedDemoClaim();
        uint64 readyAt = claims.getClaim(claimId).decidedAt + 1 days;
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.SettlementDelayActive.selector, readyAt));
        claims.settleClaim(claimId);
        vm.warp(readyAt);
        claims.settleClaim(claimId);
        assertEq(buyer.balance, EXPECTED_PAYOUT);
    }

    function test_RevertWhen_SettingsExceedBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(SupplyClaimManager.ValueTooLarge.selector);
        claims.setSettlementDelay(31 days);
        vm.expectRevert(SupplyClaimManager.ValueTooLarge.selector);
        claims.setAppealWindow(91 days);
        vm.stopPrank();
    }

    function test_RevertWhen_ClaimAfterClosure() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedDemoClaim();
        claims.settleClaim(claimId);
        vm.prank(registrar);
        rights.close(rightId, keccak256("closing-memo"));
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.SupplyRightNotClaimable.selector, SupplyStatus.Closed));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1, DELIVERED, keccak256("late-claim"));
    }

    // ------------------------------------------------------------------
    // Atomicity
    // ------------------------------------------------------------------

    function test_AtomicRevert_WhenEthPaymentFails() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedDemoClaim();
        // The beneficiary rejects ETH: the payout call fails, so the whole settlement must revert.
        vm.etch(buyer, address(new EtherRejecter()).code);
        vm.expectRevert(EtherRejecter.Rejected.selector);
        claims.settleClaim(claimId);
        _assertNothingSettled(rightId, pid, claimId);

        // Once the beneficiary accepts ETH again the same claim settles normally.
        vm.etch(buyer, "");
        claims.settleClaim(claimId);
        assertEq(buyer.balance, EXPECTED_PAYOUT);
        assertEq(recovery.ownerOf(1), provider);
    }

    function test_AtomicRevert_WhenRecoveryMintFails() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedDemoClaim();
        // The payout step runs BEFORE the mint inside settleClaim; a mint failure must undo it.
        vm.mockCallRevert(
            address(recovery), abi.encodeWithSelector(RecoveryClaimNFT.mintRecoveryClaim.selector), "MINT_FAILURE"
        );
        vm.expectRevert("MINT_FAILURE");
        claims.settleClaim(claimId);
        vm.clearMockedCalls();
        _assertNothingSettled(rightId, pid, claimId);

        // Once the failure is gone the same claim settles normally.
        claims.settleClaim(claimId);
        assertEq(buyer.balance, EXPECTED_PAYOUT);
        assertEq(recovery.ownerOf(1), provider);
    }

    function _assertNothingSettled(uint256 rightId, uint256 pid, uint256 claimId) internal view {
        assertEq(buyer.balance, 0, "buyer unpaid");
        assertEq(address(vault).balance, COVERAGE, "vault untouched");
        assertEq(vault.getProtection(pid).lockedAmount, COVERAGE);
        assertEq(vault.getProtection(pid).paidAmount, 0);
        assertTrue(vault.getProtection(pid).claimOpen);
        assertEq(recovery.totalMinted(), 0, "no recovery NFT");
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Approved));
        assertEq(claims.cumulativeSettledLoss(rightId), 0);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.UnderAssessment));
    }

    // ------------------------------------------------------------------
    // EIP-712 attestations
    // ------------------------------------------------------------------

    function _signApproval(uint256 pk, uint256 claimId, uint256 delivered, uint256 loss, bytes32 decision, address signer, uint256 nonce, uint256 deadline_)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(claims.CLAIM_APPROVAL_TYPEHASH(), claimId, delivered, loss, decision, signer, nonce, deadline_)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", claims.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_ApproveWithAttestationRelayedByAnyone() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signApproval(verifierPk, claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, 0, expiry);

        vm.prank(outsider);
        claims.approveClaimWithAttestation(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, expiry, sig);
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Approved));
        assertEq(claims.getClaim(claimId).verifier, verifier);
        assertEq(claims.nonces(verifier), 1);

        // Replay of the same signature fails (nonce consumed / state advanced).
        vm.expectRevert();
        claims.approveClaimWithAttestation(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, expiry, sig);
    }

    function test_RevertWhen_AttestationInvalid() public {
        (, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 claimId = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        uint256 expiry = block.timestamp + 1 hours;

        // Tampered amount.
        bytes memory sig = _signApproval(verifierPk, claimId, DELIVERED, 10 * ETH, keccak256("r"), verifier, 0, expiry);
        vm.expectRevert(SupplyClaimManager.InvalidAttestation.selector);
        claims.approveClaimWithAttestation(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, expiry, sig);

        // Signed by a non-verifier key but claiming to be the verifier.
        (, uint256 fakePk) = makeAddrAndKey("fake");
        sig = _signApproval(fakePk, claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, 0, expiry);
        vm.expectRevert(SupplyClaimManager.InvalidAttestation.selector);
        claims.approveClaimWithAttestation(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, expiry, sig);

        // Expired.
        sig = _signApproval(verifierPk, claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, 0, expiry);
        vm.warp(expiry + 1);
        vm.expectRevert(SupplyClaimManager.AttestationExpired.selector);
        claims.approveClaimWithAttestation(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("r"), verifier, expiry, sig);
    }

    // ------------------------------------------------------------------
    // Recovery NFT lifecycle
    // ------------------------------------------------------------------

    function test_RecoveryNFTLifecycleAndRestrictedTransfer() public {
        (,, uint256 claimId) = _approvedDemoClaim();
        uint256 rid = claims.settleClaim(claimId);

        vm.expectRevert(RecoveryClaimNFT.NotHolder.selector);
        vm.prank(buyer);
        recovery.updateRecovery(rid, RecoveryStatus.InRecovery, 0, keccak256("demand-letter"));

        vm.startPrank(provider);
        recovery.updateRecovery(rid, RecoveryStatus.InRecovery, 0, keccak256("demand-letter"));
        recovery.updateRecovery(rid, RecoveryStatus.PartiallyRecovered, 5 * ETH, keccak256("settlement-1"));
        vm.expectRevert(RecoveryClaimNFT.InvalidRecoveryUpdate.selector);
        recovery.updateRecovery(rid, RecoveryStatus.PartiallyRecovered, 4 * ETH, keccak256("decrease"));
        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, rid, outsider));
        recovery.transferFrom(provider, outsider, rid);
        vm.stopPrank();

        vm.prank(registrar);
        recovery.authorizeTransfer(rid, outsider, keccak256("assignment-deed"));
        vm.prank(provider);
        recovery.transferFrom(provider, outsider, rid);
        assertEq(recovery.ownerOf(rid), outsider);

        vm.prank(outsider);
        recovery.updateRecovery(rid, RecoveryStatus.Recovered, EXPECTED_PAYOUT, keccak256("paid-in-full"));
        assertEq(uint8(recovery.getRecoveryClaim(rid).status), uint8(RecoveryStatus.Recovered));
        assertGt(bytes(recovery.tokenURI(rid)).length, 100);
    }
}
