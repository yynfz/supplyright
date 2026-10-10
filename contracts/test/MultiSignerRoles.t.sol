// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RestrictedTransfer721} from "../src/base/RestrictedTransfer721.sol";
import {SupplyRightRoles} from "../script/lib/SupplyRightRoles.sol";
import {EtherRejecter} from "./utils/EtherRejecter.sol";
import {
    ISupplyRightNFT,
    IProtectionNFT,
    ISupplyProtectionVault,
    IRecoveryClaimNFT
} from "../src/interfaces/ISupplyRightProtocol.sol";
import {
    SupplyStatus,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionClaimStatus,
    ProtectionTerms,
    ClaimRecord,
    ClaimStatus,
    DefaultType,
    RecoveryClaimData,
    RecoveryStatus
} from "../src/SupplyTypes.sol";

/// @notice The Sepolia scenario with five distinct signers (deployer + the four role wallets), deployed and
///         role-configured exactly like Deploy.s.sol / SetupRoles.s.sol (shared SupplyRightRoles library),
///         settled in native ETH with the Sepolia amounts: 0.050 ETH PO, 0.010 ETH escrow, 0.008 ETH payout.
contract MultiSignerRolesTest is Test {
    SupplyRightRoles.Protocol internal p;
    SupplyRightRoles.Wallets internal w;
    SupplyRightNFT internal rights;
    ProtectionNFT internal protection;
    RecoveryClaimNFT internal recovery;
    SupplyProtectionVault internal vault;
    SupplyClaimManager internal claims;

    address internal deployer = makeAddr("deployer");
    address internal admin = makeAddr("supplyright-admin");
    address internal buyer = makeAddr("supplyright-buyer");
    address internal provider = makeAddr("supplyright-provider");
    address internal verifier = makeAddr("supplyright-verifier");
    address internal outsider = makeAddr("outsider");

    uint256 internal constant MT = 1e3;
    uint256 internal constant ORDERED = 50 * MT;
    uint256 internal constant DELIVERED = 10 * MT;
    uint256 internal constant CONTRACT_VALUE = 0.05 ether;
    uint256 internal constant COVERAGE = 0.010 ether;
    uint16 internal constant COVERAGE_BPS = 2_000;
    uint256 internal constant LOSS = 0.040 ether;
    uint256 internal constant PAYOUT = 0.008 ether;
    uint256 internal constant REMAINING = 0.002 ether;

    uint64 internal deadline;
    uint256 private _nonce;

    event PayoutExecuted(uint256 indexed protectionId, address indexed beneficiary, uint256 amount, uint256 remainingLocked);
    event RecoveryClaimMinted(
        uint256 indexed tokenId,
        uint256 indexed claimId,
        uint256 indexed supplyRightId,
        address provider,
        uint256 compensationAmount,
        bytes32 settlementRef
    );

    function setUp() public {
        vm.warp(1_790_000_000);
        deadline = uint64(block.timestamp + 300);

        vm.startPrank(deployer);
        rights = new SupplyRightNFT(deployer);
        protection = new ProtectionNFT(deployer);
        recovery = new RecoveryClaimNFT(deployer);
        vault = new SupplyProtectionVault(deployer, ISupplyRightNFT(address(rights)), IProtectionNFT(address(protection)));
        claims = new SupplyClaimManager(
            deployer,
            ISupplyRightNFT(address(rights)),
            ISupplyProtectionVault(address(vault)),
            IRecoveryClaimNFT(address(recovery)),
            0,
            3 days
        );
        protection.bindVault(address(vault));
        recovery.bindClaimManager(address(claims));
        rights.bindProtocol(address(vault), address(claims));
        vault.bindClaimManager(address(claims));
        p = SupplyRightRoles.Protocol(rights, protection, recovery, vault, claims);
        w = SupplyRightRoles.Wallets(admin, buyer, provider, verifier);
        SupplyRightRoles.grant(p, w);
        vm.stopPrank();

        vm.deal(provider, 0.1 ether);
    }

    // ---------------------------------------------------------------------
    // Role matrix
    // ---------------------------------------------------------------------

    function test_RoleMatrixHoldsAndIsIdempotent() public {
        assertEq(SupplyRightRoles.problems(p, w).length, 0);
        vm.prank(deployer);
        assertEq(SupplyRightRoles.grant(p, w), 0, "second run sends nothing");
        assertFalse(rights.hasRole(rights.REGISTRAR_ROLE(), deployer), "deployer is not a registrar");
    }

    function test_RoleMatrixDetectsCrossRoleGrant() public {
        bytes32 role = vault.PROVIDER_ROLE();
        vm.prank(admin);
        vault.grantRole(role, verifier);
        string[] memory issues = SupplyRightRoles.problems(p, w);
        assertEq(issues.length, 1);
        assertEq(issues[0], "forbidden verifier: PROVIDER_ROLE");
    }

    function test_RevertWhen_RoleWalletsNotDistinct() public {
        SupplyRightRoles.Wallets memory dup = SupplyRightRoles.Wallets(admin, buyer, buyer, verifier);
        vm.expectRevert(SupplyRightRoles.InvalidRoleWallets.selector);
        this.grantExternal(dup);
    }

    function grantExternal(SupplyRightRoles.Wallets memory x) external {
        vm.prank(deployer);
        SupplyRightRoles.grant(p, x);
    }

    // ---------------------------------------------------------------------
    // End to end, one signer per step
    // ---------------------------------------------------------------------

    function test_E2E_FourSignersNativeEth() public {
        // 1. admin validates the PO and mints the SupplyRight NFT to the buyer
        uint256 rightId = _registerPO();
        assertEq(rights.ownerOf(rightId), buyer);

        // 2. buyer requests protection; 3. provider sends 0.010 ETH to the vault escrow
        uint256 requestId = _request(rightId);
        uint256 providerBefore = provider.balance;
        vm.prank(provider);
        uint256 pid = vault.fundAndApproveProtection{value: COVERAGE}(requestId, keccak256("memo"));
        assertEq(providerBefore - provider.balance, COVERAGE, "provider sent exactly 0.010 ETH");
        assertEq(address(vault).balance, COVERAGE, "escrow holds 0.010 ETH");
        assertEq(protection.ownerOf(pid), buyer, "Protection NFT to the buyer");
        assertEq(vault.lockedCollateral(provider), COVERAGE);

        // 4. buyer claims after the deadline; 5. verifier approves
        vm.warp(deadline + 1);
        vm.prank(buyer);
        uint256 claimId = claims.submitClaim(pid, DefaultType.Partial, LOSS, DELIVERED, keccak256("evidence"));
        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("report"));
        assertEq(claims.getClaim(claimId).payoutAmount, PAYOUT);

        // 6. atomic settlement (triggered by the verifier; permissionless)
        uint256 buyerBefore = buyer.balance;
        vm.expectEmit(address(vault));
        emit PayoutExecuted(pid, buyer, PAYOUT, REMAINING);
        vm.expectEmit(true, true, true, false, address(recovery));
        emit RecoveryClaimMinted(1, claimId, rightId, provider, PAYOUT, bytes32(0));
        vm.prank(verifier);
        uint256 recoveryId = claims.settleClaim(claimId);

        // 7. verification
        assertEq(buyer.balance - buyerBefore, PAYOUT, "buyer +0.008 ETH");
        assertEq(address(vault).balance, REMAINING, "0.002 ETH stays in escrow");
        assertEq(recovery.ownerOf(recoveryId), provider, "Recovery Claim NFT to the provider");
        ProtectionPosition memory pos = vault.getProtection(pid);
        assertEq(pos.lockedAmount, REMAINING);
        assertEq(pos.paidAmount, PAYOUT);
        assertEq(uint8(pos.status), uint8(ProtectionStatus.Active));
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Settled));
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.Defaulted));
        assertEq(uint8(protection.getTerms(pid).claimStatus), uint8(ProtectionClaimStatus.PartiallyPaid));
        RecoveryClaimData memory rc = recovery.getRecoveryClaim(recoveryId);
        assertEq(rc.compensationAmount, PAYOUT);
        assertEq(rc.provider, provider);

        // The remaining 0.002 ETH returns to the provider only through the contract's own rules:
        // registrar closes the defaulted right -> anyone releases -> provider withdraws.
        vm.prank(admin);
        rights.close(rightId, keccak256("closing"));
        vault.releaseCollateral(pid);
        uint256 before = provider.balance;
        vm.prank(provider);
        vault.withdraw(REMAINING);
        assertEq(provider.balance - before, REMAINING);
        assertEq(address(vault).balance, 0);
    }

    // ---------------------------------------------------------------------
    // Unauthorized role access
    // ---------------------------------------------------------------------

    function test_Security_RoleWalletsCannotActOutsideTheirRole() public {
        uint256 rightId = _registerPO();
        uint256 requestId = _request(rightId);
        bytes32 providerRole = vault.PROVIDER_ROLE();

        // Buyer, verifier and admin cannot act as the provider.
        address[3] memory notProviders = [buyer, verifier, admin];
        for (uint256 i = 0; i < 3; i++) {
            vm.deal(notProviders[i], COVERAGE);
            _expectUnauthorized(notProviders[i], providerRole);
            vm.prank(notProviders[i]);
            vault.deposit{value: COVERAGE}();
            _expectUnauthorized(notProviders[i], providerRole);
            vm.prank(notProviders[i]);
            vault.fundAndApproveProtection{value: COVERAGE}(requestId, keccak256("memo"));
        }

        // Provider, verifier and admin cannot act as the buyer (owner/beneficiary checks).
        vm.expectRevert(SupplyProtectionVault.NotBuyer.selector);
        vm.prank(provider);
        vault.cancelRequest(requestId);

        uint256 pid = _fund(requestId);
        vm.warp(deadline + 1);
        address[3] memory notBuyers = [provider, verifier, admin];
        for (uint256 i = 0; i < 3; i++) {
            vm.expectRevert(SupplyClaimManager.NotBeneficiary.selector);
            vm.prank(notBuyers[i]);
            claims.submitClaim(pid, DefaultType.Partial, LOSS, DELIVERED, keccak256(abi.encode("ev", i)));
        }
    }

    // ---------------------------------------------------------------------
    // Unauthorized minting
    // ---------------------------------------------------------------------

    function test_Security_OnlyRegistrarMints() public {
        bytes32 registrarRole = rights.REGISTRAR_ROLE();
        address[4] memory notRegistrars = [buyer, provider, verifier, deployer];
        for (uint256 i = 0; i < 4; i++) {
            SupplyRightNFT.MintParams memory m = _mintParams();
            _expectUnauthorized(notRegistrars[i], registrarRole);
            vm.prank(notRegistrars[i]);
            rights.mintSupplyRight(m);
        }

        // Even the registrar can only mint to an onboarded buyer.
        SupplyRightNFT.MintParams memory toOutsider = _mintParams();
        toOutsider.buyer = outsider;
        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.BuyerNotAuthorized.selector, outsider));
        vm.prank(admin);
        rights.mintSupplyRight(toOutsider);

        // Protection and Recovery NFTs are only minted by the bound protocol contracts.
        ProtectionTerms memory t;
        t.beneficiary = buyer;
        vm.expectRevert(ProtectionNFT.NotVault.selector);
        vm.prank(admin);
        protection.mint(1, t);
        RecoveryClaimData memory d;
        vm.expectRevert(RecoveryClaimNFT.NotClaimManager.selector);
        vm.prank(admin);
        recovery.mintRecoveryClaim(provider, d);
    }

    // ---------------------------------------------------------------------
    // Unauthorized claim approval
    // ---------------------------------------------------------------------

    function test_Security_OnlyIndependentVerifierApproves() public {
        (, uint256 pid, uint256 claimId) = _claimed();
        bytes32 verifierRole = claims.VERIFIER_ROLE();
        address[4] memory notVerifiers = [buyer, provider, admin, outsider];
        for (uint256 i = 0; i < 4; i++) {
            _expectUnauthorized(notVerifiers[i], verifierRole);
            vm.prank(notVerifiers[i]);
            claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("fake"));
            _expectUnauthorized(notVerifiers[i], verifierRole);
            vm.prank(notVerifiers[i]);
            claims.rejectClaim(claimId, keccak256("fake"), "fake");
        }

        // Granting VERIFIER_ROLE to the provider does not let them decide their own protection's claim.
        vm.prank(admin);
        claims.grantRole(verifierRole, provider);
        vm.expectRevert(SupplyClaimManager.VerifierConflict.selector);
        vm.prank(provider);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("conflicted"));
        assertEq(vault.getProtection(pid).paidAmount, 0);
    }

    // ---------------------------------------------------------------------
    // Double claim / double settlement
    // ---------------------------------------------------------------------

    function test_Security_DoubleClaimRejected() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _claimed();
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ClaimAlreadyOpen.selector, claimId));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, LOSS, DELIVERED, keccak256("second-evidence"));

        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("report"));
        claims.settleClaim(claimId);

        // The same evidence can never back another claim, and the settled loss is used up.
        vm.expectRevert(SupplyClaimManager.EvidenceAlreadyUsed.selector);
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1, DELIVERED, keccak256("evidence"));
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, LOSS, 0));
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, LOSS, DELIVERED, keccak256("fresh-evidence"));
        assertEq(claims.cumulativeSettledLoss(rightId), LOSS);
    }

    function test_Security_DoubleSettlementRejected() public {
        (,, uint256 claimId) = _claimed();
        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("report"));
        claims.settleClaim(claimId);
        uint256 buyerAfterFirst = buyer.balance;

        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Settled));
        claims.settleClaim(claimId);
        assertEq(buyer.balance, buyerAfterFirst, "no second payout");
        assertEq(recovery.totalMinted(), 1, "no second Recovery NFT");
    }

    // ---------------------------------------------------------------------
    // Insufficient escrow
    // ---------------------------------------------------------------------

    function test_Security_InsufficientEscrowRejected() public {
        uint256 requestId = _request(_registerPO());

        vm.expectRevert(abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, 0, COVERAGE));
        vm.prank(provider);
        vault.approveProtection(requestId, keccak256("memo"));

        uint256 before = provider.balance;
        vm.expectRevert(
            abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, COVERAGE - 1, COVERAGE)
        );
        vm.prank(provider);
        vault.fundAndApproveProtection{value: COVERAGE - 1}(requestId, keccak256("memo"));
        assertEq(provider.balance, before, "reverted deposit returns the ETH");
        assertEq(address(vault).balance, 0);

        vm.expectRevert(SupplyProtectionVault.ZeroAmount.selector);
        vm.prank(provider);
        vault.deposit{value: 0}();

        // Plain ETH transfers are refused, so every wei in the vault is attributed collateral.
        vm.prank(provider);
        (bool ok,) = address(vault).call{value: 1 ether / 100}("");
        assertFalse(ok);
        assertEq(protection.totalMinted(), 0);
    }

    // ---------------------------------------------------------------------
    // NFT transfers
    // ---------------------------------------------------------------------

    function test_Security_NftTransferRules() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _claimed();

        // SupplyRight NFT: no transfer without a registrar-recorded assignment.
        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, rightId, outsider));
        vm.prank(buyer);
        rights.transferFrom(buyer, outsider, rightId);

        // Protection NFT: never transferable.
        vm.expectRevert(ProtectionNFT.NonTransferable.selector);
        vm.prank(buyer);
        protection.transferFrom(buyer, outsider, pid);

        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("report"));
        uint256 recoveryId = claims.settleClaim(claimId);

        // Recovery Claim NFT: only to the recipient the transfer approver authorized, exactly once.
        bytes32 approverRole = recovery.TRANSFER_APPROVER_ROLE();
        _expectUnauthorized(provider, approverRole);
        vm.prank(provider);
        recovery.authorizeTransfer(recoveryId, outsider, keccak256("assignment"));

        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, recoveryId, outsider));
        vm.prank(provider);
        recovery.transferFrom(provider, outsider, recoveryId);

        vm.prank(admin);
        recovery.authorizeTransfer(recoveryId, outsider, keccak256("assignment"));
        vm.prank(provider);
        recovery.transferFrom(provider, outsider, recoveryId);
        assertEq(recovery.ownerOf(recoveryId), outsider);

        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, recoveryId, provider));
        vm.prank(outsider);
        recovery.transferFrom(outsider, provider, recoveryId);
    }

    // ---------------------------------------------------------------------
    // Unauthorized admin action
    // ---------------------------------------------------------------------

    function test_Security_OnlyAdminAdministers() public {
        bytes32 adminRole = SupplyRightRoles.DEFAULT_ADMIN_ROLE;
        address[4] memory notAdmins = [buyer, provider, verifier, outsider];
        for (uint256 i = 0; i < 4; i++) {
            address a = notAdmins[i];
            bytes32 buyerRole = rights.BUYER_ROLE();
            _expectUnauthorized(a, adminRole);
            vm.prank(a);
            rights.grantRole(buyerRole, outsider);
            bytes32 verifierRole = claims.VERIFIER_ROLE();
            _expectUnauthorized(a, adminRole);
            vm.prank(a);
            claims.grantRole(verifierRole, a);
            _expectUnauthorized(a, adminRole);
            vm.prank(a);
            claims.setSettlementDelay(1 days);
            bytes32 providerRole = vault.PROVIDER_ROLE();
            _expectUnauthorized(a, adminRole);
            vm.prank(a);
            vault.revokeRole(providerRole, provider);
        }

        vm.startPrank(admin);
        claims.setSettlementDelay(1 hours);
        rights.grantRole(rights.BUYER_ROLE(), outsider);
        // Bindings are one-time: not even the admin can re-point payout or mint authority.
        vm.expectRevert(SupplyProtectionVault.AlreadyBound.selector);
        vault.bindClaimManager(admin);
        vm.stopPrank();
        assertEq(claims.settlementDelay(), 1 hours);
    }

    // ---------------------------------------------------------------------
    // Atomic settlement rollback
    // ---------------------------------------------------------------------

    function test_Security_SettlementRollsBackWhenPayoutFails() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedClaim();
        vm.etch(buyer, address(new EtherRejecter()).code);
        vm.expectRevert(EtherRejecter.Rejected.selector);
        claims.settleClaim(claimId);
        _assertUnsettled(rightId, pid, claimId);
    }

    function test_Security_SettlementRollsBackWhenRecoveryMintFails() public {
        (uint256 rightId, uint256 pid, uint256 claimId) = _approvedClaim();
        vm.mockCallRevert(
            address(recovery), abi.encodeWithSelector(RecoveryClaimNFT.mintRecoveryClaim.selector), "MINT_FAILURE"
        );
        uint256 buyerBefore = buyer.balance;
        vm.expectRevert("MINT_FAILURE");
        claims.settleClaim(claimId);
        assertEq(buyer.balance, buyerBefore, "payout undone");
        _assertUnsettled(rightId, pid, claimId);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _mintParams() internal returns (SupplyRightNFT.MintParams memory) {
        _nonce++;
        return SupplyRightNFT.MintParams({
            buyer: buyer,
            poRefHash: keccak256(abi.encode("PO", _nonce)),
            agreementHash: keccak256(abi.encode("SA", _nonce)),
            supplierRefHash: keccak256("supplier"),
            contractValue: CONTRACT_VALUE,
            orderedQuantity: ORDERED,
            deliveryDeadline: deadline,
            unit: bytes8("MT")
        });
    }

    function _registerPO() internal returns (uint256 rightId) {
        SupplyRightNFT.MintParams memory m = _mintParams();
        vm.startPrank(admin);
        rightId = rights.mintSupplyRight(m);
        rights.activate(rightId, keccak256("ack"));
        rights.recordDelivery(rightId, DELIVERED, keccak256("delivery-note"));
        vm.stopPrank();
    }

    function _request(uint256 rightId) internal returns (uint256 requestId) {
        vm.prank(buyer);
        requestId = vault.requestProtection(rightId, provider, COVERAGE, COVERAGE_BPS, deadline + 30 days, keccak256("terms"));
    }

    function _fund(uint256 requestId) internal returns (uint256 pid) {
        vm.prank(provider);
        pid = vault.fundAndApproveProtection{value: COVERAGE}(requestId, keccak256("memo"));
    }

    function _claimed() internal returns (uint256 rightId, uint256 pid, uint256 claimId) {
        rightId = _registerPO();
        pid = _fund(_request(rightId));
        vm.warp(deadline + 1);
        vm.prank(buyer);
        claimId = claims.submitClaim(pid, DefaultType.Partial, LOSS, DELIVERED, keccak256("evidence"));
    }

    function _approvedClaim() internal returns (uint256 rightId, uint256 pid, uint256 claimId) {
        (rightId, pid, claimId) = _claimed();
        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, LOSS, keccak256("report"));
    }

    function _assertUnsettled(uint256 rightId, uint256 pid, uint256 claimId) internal view {
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Approved));
        assertEq(address(vault).balance, COVERAGE, "escrow untouched");
        assertEq(vault.getProtection(pid).lockedAmount, COVERAGE);
        assertEq(vault.getProtection(pid).paidAmount, 0);
        assertEq(vault.totalPaidOut(), 0);
        assertEq(recovery.totalMinted(), 0, "no Recovery NFT");
        assertEq(claims.cumulativeSettledLoss(rightId), 0);
        assertEq(uint8(rights.getSupplyRight(rightId).status), uint8(SupplyStatus.UnderAssessment));
    }

    function _expectUnauthorized(address account, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role));
    }
}
