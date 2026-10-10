// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MockETH} from "../src/MockETH.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RestrictedTransfer721} from "../src/base/RestrictedTransfer721.sol";
import {
    ISupplyRightNFT,
    IProtectionNFT,
    ISupplyProtectionVault,
    IRecoveryClaimNFT
} from "../src/interfaces/ISupplyRightProtocol.sol";
import {
    SupplyStatus,
    RequestStatus,
    ProtectionPosition,
    ProtectionStatus,
    ProtectionClaimStatus,
    ClaimRecord,
    ClaimStatus,
    DefaultType,
    RecoveryClaimData,
    RecoveryStatus
} from "../src/SupplyTypes.sol";

/// @notice Multi-signer integration test suite for the 4 SupplyRight role wallets:
///         Buyer: 0x6ACF72e4047d26b1C0AA6292BD38B03E9a70580B
///         Provider: 0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066
///         Verifier: 0x4481A845dFb7855dC1e0946C26965f4a856B12dD
///         Admin: 0x3a570002A98Bbe4cC7A182ccdbb5EF0dc2633CBc
contract MultiSignerRolesTest is Test {
    SupplyRightNFT internal rights;
    ProtectionNFT internal protection;
    RecoveryClaimNFT internal recovery;
    SupplyProtectionVault internal vault;
    SupplyClaimManager internal claims;
    MockETH internal meth;

    address internal deployer = 0xCf2661F9334416ef8D6be26ad520FFE0d2899dff;
    address internal buyer = 0x6ACF72e4047d26b1C0AA6292BD38B03E9a70580B;
    address internal provider = 0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066;
    address internal verifier = 0x4481A845dFb7855dC1e0946C26965f4a856B12dD;
    address internal admin = 0x3a570002A98Bbe4cC7A182ccdbb5EF0dc2633CBc;
    address internal outsider = makeAddr("unauthorized-outsider");

    uint256 internal constant MT = 1e3;
    uint256 internal constant CONTRACT_VAL = 0.05 ether;
    uint256 internal constant COVERAGE = 0.010 ether; // 0.010 Sepolia ETH target
    uint16 internal constant COVERAGE_BPS = 2_000;    // 20%
    uint256 internal constant DELIVERED = 10 * MT;
    uint256 internal constant SHORTFALL_LOSS = 0.040 ether;
    uint256 internal constant EXPECTED_PAYOUT = 0.008 ether; // 20% of 0.040 = 0.008 ETH to buyer, 0.002 remains in vault

    function setUp() public {
        vm.warp(1_750_000_000);

        // Deploy contracts as deployer
        vm.startPrank(deployer);
        meth = new MockETH();
        rights = new SupplyRightNFT(deployer);
        protection = new ProtectionNFT(deployer);
        recovery = new RecoveryClaimNFT(deployer);
        vault = new SupplyProtectionVault(
            deployer, meth, ISupplyRightNFT(address(rights)), IProtectionNFT(address(protection))
        );
        claims = new SupplyClaimManager(
            deployer,
            ISupplyRightNFT(address(rights)),
            ISupplyProtectionVault(address(vault)),
            IRecoveryClaimNFT(address(recovery)),
            0,
            3 days
        );

        // Wire contracts
        protection.bindVault(address(vault));
        recovery.bindClaimManager(address(claims));
        rights.bindProtocol(address(vault), address(claims));
        vault.bindClaimManager(address(claims));

        // Grant roles to the 4 dedicated role wallets
        rights.grantRole(rights.BUYER_ROLE(), buyer);
        vault.grantRole(vault.PROVIDER_ROLE(), provider);
        claims.grantRole(claims.VERIFIER_ROLE(), verifier);

        rights.grantRole(rights.REGISTRAR_ROLE(), admin);
        rights.grantRole(rights.TRANSFER_APPROVER_ROLE(), admin);
        recovery.grantRole(recovery.TRANSFER_APPROVER_ROLE(), admin);
        rights.grantRole(rights.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        claims.grantRole(claims.DEFAULT_ADMIN_ROLE(), admin);
        recovery.grantRole(recovery.DEFAULT_ADMIN_ROLE(), admin);
        vm.stopPrank();

        // Fund provider with settlement tokens
        vm.startPrank(provider);
        meth.faucet(10 ether);
        meth.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // Full Happy Path E2E Flow (Separate Signers)
    // -------------------------------------------------------------------------
    function test_MultiSigner_FullE2EFlow() public {
        uint64 deadline = uint64(block.timestamp + 10 days);
        bytes32 poHash = keccak256("PO-TEST-001");
        bytes32 agreementHash = keccak256("AGREEMENT-TEST-001");
        bytes32 supplierRefHash = keccak256("SUPPLIER-TEST-001");

        // 1. Admin validates PO offchain and mints SupplyRight NFT to buyer
        vm.startPrank(admin);
        uint256 tokenId = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: poHash,
                agreementHash: agreementHash,
                supplierRefHash: supplierRefHash,
                contractValue: CONTRACT_VAL,
                orderedQuantity: 50 * MT,
                deliveryDeadline: deadline,
                unit: bytes8("MT")
            })
        );
        rights.activate(tokenId, keccak256("SUPPLIER-ACK-001"));
        rights.recordDelivery(tokenId, DELIVERED, keccak256("DN-DELIVERY-001"));
        vm.stopPrank();

        assertEq(rights.ownerOf(tokenId), buyer, "Buyer must own the SupplyRight NFT");

        // 2. Buyer requests protection
        vm.prank(buyer);
        uint256 reqId = vault.requestProtection(
            tokenId,
            provider,
            COVERAGE,
            COVERAGE_BPS,
            deadline + 30 days,
            keccak256("TERMS-001")
        );

        // 3. Provider deposits escrow (exactly 0.010 ETH / mETH) and approves
        vm.startPrank(provider);
        vault.deposit(COVERAGE);
        uint256 protectionId = vault.approveProtection(reqId, keccak256("MEMO-UNDERWRITE-001"));
        vm.stopPrank();

        assertEq(protection.ownerOf(protectionId), buyer, "Buyer receives Protection NFT");
        assertEq(vault.lockedCollateral(provider), COVERAGE, "Provider locked exactly 0.010 in escrow");

        // 4. Time passes past deadline, supplier failure occurs
        vm.warp(deadline + 1);

        // Buyer submits claim
        vm.prank(buyer);
        uint256 claimId = claims.submitClaim(
            protectionId,
            DefaultType.Partial,
            SHORTFALL_LOSS,
            DELIVERED,
            keccak256("EVIDENCE-FAILURE-001")
        );

        // 5. Verifier inspects failure and approves claim
        vm.prank(verifier);
        claims.approveClaim(
            claimId,
            DELIVERED,
            SHORTFALL_LOSS,
            keccak256("VERIFIER-DECISION-001")
        );

        ClaimRecord memory c = claims.getClaim(claimId);
        assertEq(c.payoutAmount, EXPECTED_PAYOUT, "Expected payout must be 0.008 ETH");

        // 6. Atomic settlement triggered
        uint256 buyerBalanceBefore = meth.balanceOf(buyer);
        uint256 recoveryNftId = claims.settleClaim(claimId);

        // Verify economic settlement & NFT transfers
        assertEq(meth.balanceOf(buyer), buyerBalanceBefore + EXPECTED_PAYOUT, "Buyer receives 0.008 ETH");
        assertEq(recovery.ownerOf(recoveryNftId), provider, "Provider receives Recovery Claim NFT");
        ProtectionPosition memory pos = vault.getProtection(protectionId);
        assertEq(pos.lockedAmount, 0.002 ether, "0.002 ETH remains safely locked according to protocol");
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Settled));
    }

    // -------------------------------------------------------------------------
    // Negative Tests (Security & Role Enforcement)
    // -------------------------------------------------------------------------

    function test_Security_UnauthorizedRoleAccess() public {
        bytes32 buyerRole = rights.BUYER_ROLE();
        bytes32 verifierRole = claims.VERIFIER_ROLE();
        bytes32 providerRole = vault.PROVIDER_ROLE();

        // Outsider cannot perform buyer, provider, or verifier actions
        assertFalse(rights.hasRole(buyerRole, outsider));
        assertFalse(claims.hasRole(verifierRole, outsider));
        assertFalse(vault.hasRole(providerRole, outsider));
    }

    function test_Security_UnauthorizedMinting() public {
        bytes32 registrarRole = rights.REGISTRAR_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registrarRole)
        );
        vm.prank(outsider);
        rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: keccak256("PO-FAKE"),
                agreementHash: keccak256("AGR-FAKE"),
                supplierRefHash: keccak256("SUP-FAKE"),
                contractValue: CONTRACT_VAL,
                orderedQuantity: 50 * MT,
                deliveryDeadline: uint64(block.timestamp + 10 days),
                unit: bytes8("MT")
            })
        );
    }

    function test_Security_UnauthorizedClaimApproval() public {
        uint256 claimId = _setupAndSubmitClaim();
        bytes32 verifierRole = claims.VERIFIER_ROLE();

        // Buyer cannot approve their own claim
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, buyer, verifierRole)
        );
        vm.prank(buyer);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("DECISION-FAKE"));

        // Outsider cannot approve claim
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, verifierRole)
        );
        vm.prank(outsider);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("DECISION-FAKE"));
    }

    function test_Security_DoubleClaimPrevention() public {
        uint256 claimId = _setupAndSubmitClaim();
        (ClaimRecord memory c) = claims.getClaim(claimId);

        // Buyer attempts to submit second claim while first is open
        vm.expectRevert(abi.encodeWithSelector(SupplyClaimManager.ClaimAlreadyOpen.selector, claimId));
        vm.prank(buyer);
        claims.submitClaim(c.protectionId, DefaultType.Partial, SHORTFALL_LOSS, DELIVERED, keccak256("EV-2"));
    }

    function test_Security_InsufficientEscrow() public {
        uint64 deadline = uint64(block.timestamp + 10 days);
        vm.prank(admin);
        uint256 tokenId = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: keccak256("PO-ESCROW"),
                agreementHash: keccak256("AGR-ESCROW"),
                supplierRefHash: keccak256("SUP-ESCROW"),
                contractValue: CONTRACT_VAL,
                orderedQuantity: 50 * MT,
                deliveryDeadline: deadline,
                unit: bytes8("MT")
            })
        );
        vm.prank(admin);
        rights.activate(tokenId, keccak256("ACK-ESCROW"));

        vm.prank(buyer);
        uint256 reqId = vault.requestProtection(
            tokenId, provider, COVERAGE, COVERAGE_BPS, deadline + 30 days, keccak256("TERMS-ESCROW")
        );

        // Provider tries to approve without having deposited sufficient free collateral
        vm.expectRevert(
            abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, 0, COVERAGE)
        );
        vm.prank(provider);
        vault.approveProtection(reqId, keccak256("MEMO-ESCROW"));
    }

    function test_Security_InvalidNFTTransfer() public {
        uint64 deadline = uint64(block.timestamp + 10 days);
        vm.prank(admin);
        uint256 tokenId = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: keccak256("PO-TRANSFER"),
                agreementHash: keccak256("AGR-TRANSFER"),
                supplierRefHash: keccak256("SUP-TRANSFER"),
                contractValue: CONTRACT_VAL,
                orderedQuantity: 50 * MT,
                deliveryDeadline: deadline,
                unit: bytes8("MT")
            })
        );

        // Transfer without approver authorization reverts
        vm.expectRevert(
            abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, tokenId, outsider)
        );
        vm.prank(buyer);
        rights.transferFrom(buyer, outsider, tokenId);

        // Protection NFT is strictly non-transferable
        vm.prank(buyer);
        uint256 reqId = vault.requestProtection(
            tokenId, provider, COVERAGE, COVERAGE_BPS, deadline + 30 days, keccak256("TERMS-P")
        );
        vm.startPrank(provider);
        vault.deposit(COVERAGE);
        uint256 pid = vault.approveProtection(reqId, keccak256("MEMO-P"));
        vm.stopPrank();

        vm.expectRevert(ProtectionNFT.NonTransferable.selector);
        vm.prank(buyer);
        protection.transferFrom(buyer, outsider, pid);
    }

    function test_Security_DoubleSettlementPrevention() public {
        uint256 claimId = _setupAndSubmitClaim();
        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("DECISION-001"));

        // First settlement succeeds
        claims.settleClaim(claimId);

        // Duplicate settlement fails
        vm.expectRevert(
            abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Settled)
        );
        claims.settleClaim(claimId);
    }

    function test_Security_UnauthorizedAdminAction() public {
        bytes32 adminRole = rights.DEFAULT_ADMIN_ROLE();
        bytes32 buyerRole = rights.BUYER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, adminRole)
        );
        vm.prank(outsider);
        rights.grantRole(buyerRole, outsider);
    }

    function test_Security_AtomicRollbackOnFailure() public {
        // If settlement token transfer reverts, the entire state and NFT mint roll back
        uint256 claimId = _setupAndSubmitClaim();
        vm.prank(verifier);
        claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("DECISION-001"));

        // Drain vault to induce transfer failure
        uint256 vaultBal = meth.balanceOf(address(vault));
        vm.prank(address(vault));
        meth.transfer(outsider, vaultBal);

        vm.expectRevert();
        claims.settleClaim(claimId);

        // State remains Approved, not Settled
        assertEq(uint8(claims.getClaim(claimId).status), uint8(ClaimStatus.Approved));
        assertEq(recovery.totalMinted(), 0, "No Recovery NFT minted on rollback");
    }

    // --- Helper ---
    function _setupAndSubmitClaim() internal returns (uint256 claimId) {
        uint64 deadline = uint64(block.timestamp + 10 days);
        vm.startPrank(admin);
        uint256 tokenId = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: keccak256("PO-TEST"),
                agreementHash: keccak256("AGR-TEST"),
                supplierRefHash: keccak256("SUP-TEST"),
                contractValue: CONTRACT_VAL,
                orderedQuantity: 50 * MT,
                deliveryDeadline: deadline,
                unit: bytes8("MT")
            })
        );
        rights.activate(tokenId, keccak256("ACK-TEST"));
        rights.recordDelivery(tokenId, DELIVERED, keccak256("DN-TEST"));
        vm.stopPrank();

        vm.prank(buyer);
        uint256 reqId = vault.requestProtection(
            tokenId, provider, COVERAGE, COVERAGE_BPS, deadline + 30 days, keccak256("TERMS-TEST")
        );

        vm.startPrank(provider);
        vault.deposit(COVERAGE);
        uint256 pid = vault.approveProtection(reqId, keccak256("MEMO-TEST"));
        vm.stopPrank();

        vm.warp(deadline + 1);

        vm.prank(buyer);
        claimId = claims.submitClaim(
            pid, DefaultType.Partial, SHORTFALL_LOSS, DELIVERED, keccak256("EV-TEST")
        );
    }
}

