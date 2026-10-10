// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {
    ISupplyRightNFT,
    IProtectionNFT,
    ISupplyProtectionVault,
    IRecoveryClaimNFT
} from "../src/interfaces/ISupplyRightProtocol.sol";
import {DefaultType} from "../src/SupplyTypes.sol";

/// @notice Deploys and wires the full protocol with the fictional demo case-study parameters:
///         50 MT ordered for 100 ETH, 20 ETH coverage at 20% of verified loss (native ETH, wei units).
abstract contract SupplyRightFixture is Test {
    SupplyRightNFT internal rights;
    ProtectionNFT internal protection;
    RecoveryClaimNFT internal recovery;
    SupplyProtectionVault internal vault;
    SupplyClaimManager internal claims;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal buyer = makeAddr("buyer");
    address internal provider = makeAddr("provider");
    address internal outsider = makeAddr("outsider");
    address internal verifier;
    uint256 internal verifierPk;

    uint256 internal constant ETH = 1 ether;
    uint256 internal constant MT = 1e3;
    uint256 internal constant CONTRACT_VALUE = 100 * ETH;
    uint256 internal constant ORDERED = 50 * MT;
    uint256 internal constant DELIVERED = 10 * MT;
    uint256 internal constant COVERAGE = 20 * ETH;
    uint16 internal constant COVERAGE_BPS = 2_000;
    uint256 internal constant SHORTFALL_LOSS = 80 * ETH; // 40 MT undelivered x 2 ETH per MT
    uint256 internal constant EXPECTED_PAYOUT = 16 * ETH;

    uint64 internal deadline;
    uint64 internal protectionExpiry;
    uint256 private _poNonce;
    uint256 private _evidenceNonce;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        (verifier, verifierPk) = makeAddrAndKey("verifier");

        rights = new SupplyRightNFT(admin);
        protection = new ProtectionNFT(admin);
        recovery = new RecoveryClaimNFT(admin);
        vault = new SupplyProtectionVault(admin, ISupplyRightNFT(address(rights)), IProtectionNFT(address(protection)));
        claims = new SupplyClaimManager(
            admin,
            ISupplyRightNFT(address(rights)),
            ISupplyProtectionVault(address(vault)),
            IRecoveryClaimNFT(address(recovery)),
            0,
            7 days
        );

        vm.startPrank(admin);
        protection.bindVault(address(vault));
        recovery.bindClaimManager(address(claims));
        rights.bindProtocol(address(vault), address(claims));
        vault.bindClaimManager(address(claims));
        rights.grantRole(rights.REGISTRAR_ROLE(), registrar);
        rights.grantRole(rights.TRANSFER_APPROVER_ROLE(), registrar);
        recovery.grantRole(recovery.TRANSFER_APPROVER_ROLE(), registrar);
        rights.grantRole(rights.BUYER_ROLE(), buyer);
        vault.grantRole(vault.PROVIDER_ROLE(), provider);
        claims.grantRole(claims.VERIFIER_ROLE(), verifier);
        vm.stopPrank();

        vm.deal(provider, 1_000 * ETH);

        deadline = uint64(block.timestamp + 30 days);
        protectionExpiry = deadline + 60 days;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _mintParams() internal returns (SupplyRightNFT.MintParams memory) {
        _poNonce++;
        return SupplyRightNFT.MintParams({
            buyer: buyer,
            poRefHash: keccak256(abi.encode("PO", _poNonce)),
            agreementHash: keccak256(abi.encode("AGREEMENT", _poNonce)),
            supplierRefHash: keccak256("PT Fiktif Logam Nusantara"),
            contractValue: CONTRACT_VALUE,
            orderedQuantity: ORDERED,
            deliveryDeadline: deadline,
            unit: bytes8("MT")
        });
    }

    function _mintRight() internal returns (uint256 id) {
        SupplyRightNFT.MintParams memory p = _mintParams();
        vm.prank(registrar);
        id = rights.mintSupplyRight(p);
    }

    function _mintActiveRight() internal returns (uint256 id) {
        id = _mintRight();
        vm.prank(registrar);
        rights.activate(id, keccak256("supplier-ack"));
    }

    function _request(uint256 rightId) internal returns (uint256 requestId) {
        vm.prank(buyer);
        requestId = vault.requestProtection(
            rightId, provider, COVERAGE, COVERAGE_BPS, protectionExpiry, keccak256("protection-terms")
        );
    }

    function _protect(uint256 rightId) internal returns (uint256 protectionId) {
        uint256 requestId = _request(rightId);
        vm.prank(provider);
        protectionId = vault.fundAndApproveProtection{value: COVERAGE}(requestId, keccak256("underwriting-memo"));
    }

    function _setupProtected() internal returns (uint256 rightId, uint256 protectionId) {
        rightId = _mintActiveRight();
        protectionId = _protect(rightId);
    }

    function _passDeadline() internal {
        vm.warp(deadline + 1);
    }

    function _evidence() internal returns (bytes32) {
        _evidenceNonce++;
        return keccak256(abi.encode("evidence", _evidenceNonce));
    }

    function _submitPartial(uint256 protectionId, uint256 delivered, uint256 loss) internal returns (uint256 id) {
        vm.prank(buyer);
        id = claims.submitClaim(protectionId, DefaultType.Partial, loss, delivered, _evidence());
    }

    function _approve(uint256 claimId, uint256 delivered, uint256 loss) internal {
        vm.prank(verifier);
        claims.approveClaim(claimId, delivered, loss, keccak256(abi.encode("verifier-report", claimId)));
    }

    /// @dev Full demo path up to an approved 80 ETH loss claim (payout quote 16 ETH).
    function _approvedDemoClaim() internal returns (uint256 rightId, uint256 protectionId, uint256 claimId) {
        (rightId, protectionId) = _setupProtected();
        _passDeadline();
        claimId = _submitPartial(protectionId, DELIVERED, SHORTFALL_LOSS);
        _approve(claimId, DELIVERED, SHORTFALL_LOSS);
    }
}
