// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SupplyRightFixture} from "./Fixture.t.sol";
import {EtherRejecter} from "./utils/EtherRejecter.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {
    SupplyStatus,
    RequestStatus,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionTerms,
    ProtectionClaimStatus,
    DefaultType
} from "../src/SupplyTypes.sol";

contract SupplyProtectionVaultTest is SupplyRightFixture {
    function test_FundAndApproveLocksCollateralAndMintsProtectionNFT() public {
        (uint256 rightId, uint256 pid) = _setupProtected();

        ProtectionPosition memory p = vault.getProtection(pid);
        assertEq(p.supplyRightId, rightId);
        assertEq(p.provider, provider);
        assertEq(p.beneficiary, buyer);
        assertEq(p.coverageAmount, COVERAGE);
        assertEq(p.lockedAmount, COVERAGE);
        assertEq(uint8(p.status), uint8(ProtectionStatus.Active));
        assertEq(vault.lockedCollateral(provider), COVERAGE);
        assertEq(vault.freeCollateral(provider), 0);
        assertEq(address(vault).balance, COVERAGE);

        assertEq(protection.ownerOf(pid), buyer);
        ProtectionTerms memory t = protection.getTerms(pid);
        assertEq(t.coverageAmount, COVERAGE);
        assertEq(t.coverageBps, COVERAGE_BPS);
        assertEq(t.escrowVault, address(vault));
        assertEq(t.escrowId, pid);
        assertEq(rights.getSupplyRight(rightId).protectionId, pid);
    }

    function test_RevertWhen_CoverageNotFunded() public {
        uint256 rightId = _mintActiveRight();
        uint256 requestId = _request(rightId);

        // Provider has deposited less than the requested coverage.
        vm.prank(provider);
        vault.deposit{value: COVERAGE - 1}();
        vm.expectRevert(
            abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, COVERAGE - 1, COVERAGE)
        );
        vm.prank(provider);
        vault.approveProtection(requestId, keccak256("memo"));

        assertEq(protection.totalMinted(), 0);
        assertEq(rights.getSupplyRight(rightId).protectionId, 0);
        assertEq(uint8(vault.getRequest(requestId).status), uint8(RequestStatus.Pending));
    }

    function test_DepositThenApproveUsesFreeCollateral() public {
        uint256 rightId = _mintActiveRight();
        uint256 requestId = _request(rightId);
        vm.startPrank(provider);
        vault.deposit{value: 50 * ETH}();
        uint256 pid = vault.approveProtection(requestId, keccak256("memo"));
        vm.stopPrank();
        assertEq(vault.freeCollateral(provider), 30 * ETH);
        assertEq(vault.lockedCollateral(provider), COVERAGE);
        assertEq(vault.getProtection(pid).lockedAmount, COVERAGE);
    }

    function test_RevertWhen_UnauthorizedProviderApproves() public {
        uint256 requestId = _request(_mintActiveRight());
        bytes32 role = vault.PROVIDER_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, role));
        vm.prank(outsider);
        vault.fundAndApproveProtection(requestId, keccak256("memo"));
    }

    function test_RevertWhen_NonDesignatedProviderApproves() public {
        address other = makeAddr("otherProvider");
        bytes32 role = vault.PROVIDER_ROLE();
        vm.prank(admin);
        vault.grantRole(role, other);
        uint256 requestId = _request(_mintActiveRight());
        vm.expectRevert(SupplyProtectionVault.NotDesignatedProvider.selector);
        vm.prank(other);
        vault.fundAndApproveProtection(requestId, keccak256("memo"));
    }

    function test_RequestValidation() public {
        uint256 rightId = _mintActiveRight();
        bytes32 terms = keccak256("terms");

        vm.expectRevert(SupplyProtectionVault.NotBuyer.selector);
        vm.prank(outsider);
        vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, protectionExpiry, terms);

        vm.startPrank(buyer);
        vm.expectRevert(SupplyProtectionVault.InvalidCoverage.selector);
        vault.requestProtection(rightId, provider, CONTRACT_VALUE + 1, COVERAGE_BPS, protectionExpiry, terms);
        vm.expectRevert(SupplyProtectionVault.InvalidCoverage.selector);
        vault.requestProtection(rightId, provider, COVERAGE, 10_001, protectionExpiry, terms);
        vm.expectRevert(SupplyProtectionVault.InvalidExpiry.selector);
        vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, deadline, terms);
        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.NotProvider.selector, outsider));
        vault.requestProtection(rightId, outsider, COVERAGE, COVERAGE_BPS, protectionExpiry, terms);

        uint256 requestId = vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, protectionExpiry, terms);
        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.RequestAlreadyPending.selector, requestId));
        vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, protectionExpiry, terms);
        vm.stopPrank();
    }

    function test_RejectAndCancelRequests() public {
        uint256 rightId = _mintActiveRight();
        uint256 r1 = _request(rightId);
        vm.prank(provider);
        vault.rejectRequest(r1, keccak256("too risky"));
        assertEq(uint8(vault.getRequest(r1).status), uint8(RequestStatus.Rejected));
        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.RequestNotPending.selector, RequestStatus.Rejected));
        vm.prank(provider);
        vault.fundAndApproveProtection(r1, keccak256("memo"));

        uint256 r2 = _request(rightId);
        vm.prank(buyer);
        vault.cancelRequest(r2);
        assertEq(uint8(vault.getRequest(r2).status), uint8(RequestStatus.Cancelled));

        // A fresh request after rejection/cancellation can still be funded.
        uint256 pid = _protect(rightId);
        assertEq(rights.getSupplyRight(rightId).protectionId, pid);
    }

    function test_RevertWhen_SecondProtectionOnSameRight() public {
        (uint256 rightId, uint256 pid) = _setupProtected();
        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.AlreadyProtected.selector, pid));
        vm.prank(buyer);
        vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, protectionExpiry, keccak256("terms"));
    }

    // ------------------------------------------------------------------
    // Collateral safety
    // ------------------------------------------------------------------

    function test_CommittedCollateralCannotBeWithdrawn() public {
        (uint256 rightId, uint256 pid) = _setupProtected();

        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, 0, 1));
        vm.prank(provider);
        vault.withdraw(1);

        // Release is not allowed while the agreement is still running and coverage is valid.
        vm.expectRevert(SupplyProtectionVault.ReleaseNotAllowed.selector);
        vault.releaseCollateral(pid);

        // Nor while a claim is open, even after expiry.
        _passDeadline();
        _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.warp(protectionExpiry + 1);
        vm.expectRevert(SupplyProtectionVault.ReleaseBlockedByClaim.selector);
        vault.releaseCollateral(pid);

        // Admin has no path to the locked funds either.
        vm.expectRevert(SupplyProtectionVault.NotClaimManager.selector);
        vm.prank(admin);
        vault.executePayout(pid, 1);

        assertEq(vault.lockedCollateral(provider), COVERAGE);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.UnderAssessment));
    }

    function test_ReleaseAfterClosureReturnsUnusedCollateral() public {
        (uint256 rightId, uint256 pid,) = _approvedDemoClaimSettled();
        vm.prank(registrar);
        rights.close(rightId, keccak256("closing-memo"));

        vault.releaseCollateral(pid);
        ProtectionPosition memory p = vault.getProtection(pid);
        assertEq(uint8(p.status), uint8(ProtectionStatus.Released));
        assertEq(p.lockedAmount, 0);
        assertEq(p.releasedAmount, COVERAGE - EXPECTED_PAYOUT);
        assertEq(vault.freeCollateral(provider), 4 * ETH);
        assertEq(uint8(protection.getTerms(pid).claimStatus), uint8(ProtectionClaimStatus.Released));

        uint256 before = provider.balance;
        vm.prank(provider);
        vault.withdraw(4 * ETH);
        assertEq(provider.balance, before + 4 * ETH);
        assertEq(address(vault).balance, 0);

        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.ProtectionNotActive.selector, ProtectionStatus.Released));
        vault.releaseCollateral(pid);
    }

    function test_ReleaseAfterExpiryWithoutClaims() public {
        (, uint256 pid) = _setupProtected();
        vm.warp(protectionExpiry + 1);
        vault.releaseCollateral(pid);
        assertEq(vault.freeCollateral(provider), COVERAGE);
    }

    function test_FundAndApproveCreditsExcessEthAsFreeCollateral() public {
        uint256 requestId = _request(_mintActiveRight());
        vm.prank(provider);
        vault.fundAndApproveProtection{value: COVERAGE + 1 ether}(requestId, keccak256("memo"));
        assertEq(vault.lockedCollateral(provider), COVERAGE);
        assertEq(vault.freeCollateral(provider), 1 ether);
        assertEq(address(vault).balance, COVERAGE + 1 ether);
    }

    function test_FundAndApproveUsesFreeCollateralFirst() public {
        vm.prank(provider);
        vault.deposit{value: 5 ether}();
        uint256 requestId = _request(_mintActiveRight());
        vm.prank(provider);
        vault.fundAndApproveProtection{value: COVERAGE - 5 ether}(requestId, keccak256("memo"));
        assertEq(vault.freeCollateral(provider), 0);
        assertEq(vault.lockedCollateral(provider), COVERAGE);
        assertEq(address(vault).balance, COVERAGE);
    }

    function test_RevertWhen_PlainEthSentToVault() public {
        vm.prank(provider);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "no receive/fallback: unattributed ETH is refused");
        assertEq(address(vault).balance, 0);
    }

    function test_FailedEthWithdrawalKeepsAccounting() public {
        vm.prank(provider);
        vault.deposit{value: 1 ether}();
        vm.etch(provider, address(new EtherRejecter()).code);
        vm.expectRevert(EtherRejecter.Rejected.selector);
        vm.prank(provider);
        vault.withdraw(1 ether);
        assertEq(vault.freeCollateral(provider), 1 ether);
        assertEq(vault.totalFreeCollateral(), 1 ether);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_WithdrawStillPossibleAfterRoleRevoked() public {
        vm.prank(provider);
        vault.deposit{value: 1 * ETH}();
        bytes32 role = vault.PROVIDER_ROLE();
        vm.prank(admin);
        vault.revokeRole(role, provider);
        vm.prank(provider);
        vault.withdraw(1 * ETH);
        assertEq(vault.freeCollateral(provider), 0);
    }

    function test_ClaimHooksOnlyCallableByClaimManager() public {
        (, uint256 pid) = _setupProtected();
        vm.startPrank(outsider);
        vm.expectRevert(SupplyProtectionVault.NotClaimManager.selector);
        vault.openClaim(pid, true);
        vm.expectRevert(SupplyProtectionVault.NotClaimManager.selector);
        vault.closeClaim(pid);
        vm.expectRevert(SupplyProtectionVault.NotClaimManager.selector);
        vault.setClaimStage(pid, ProtectionClaimStatus.ClaimApproved);
        vm.expectRevert(SupplyProtectionVault.NotClaimManager.selector);
        vault.executePayout(pid, 1);
        vm.stopPrank();

        vm.expectRevert(SupplyProtectionVault.AlreadyBound.selector);
        vm.prank(admin);
        vault.bindClaimManager(outsider);
    }

    function test_ProtectionNFTIsNonTransferableAndVaultMinted() public {
        (, uint256 pid) = _setupProtected();
        vm.expectRevert(ProtectionNFT.NonTransferable.selector);
        vm.prank(buyer);
        protection.transferFrom(buyer, outsider, pid);

        ProtectionTerms memory t = protection.getTerms(pid);
        vm.expectRevert(ProtectionNFT.NotVault.selector);
        vm.prank(admin);
        protection.mint(999, t);
        assertGt(bytes(protection.tokenURI(pid)).length, 100);
    }

    function testFuzz_QuotePayoutNeverExceedsCoverage(uint256 loss, uint16 bps) public {
        bps = uint16(bound(bps, 1, 10_000));
        loss = bound(loss, 0, CONTRACT_VALUE * 10);
        uint256 rightId = _mintActiveRight();
        vm.prank(buyer);
        uint256 requestId =
            vault.requestProtection(rightId, provider, COVERAGE, bps, protectionExpiry, keccak256("terms"));
        vm.prank(provider);
        uint256 pid = vault.fundAndApproveProtection{value: COVERAGE}(requestId, keccak256("memo"));
        uint256 quote = vault.quotePayout(pid, loss);
        assertLe(quote, COVERAGE);
        assertLe(quote, (loss * bps) / 10_000);
    }

    // ------------------------------------------------------------------

    function _approvedDemoClaimSettled() internal returns (uint256 rightId, uint256 pid, uint256 claimId) {
        (rightId, pid, claimId) = _approvedDemoClaim();
        claims.settleClaim(claimId);
    }
}
