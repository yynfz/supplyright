// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SupplyRightFixture} from "./Fixture.t.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {RestrictedTransfer721} from "../src/base/RestrictedTransfer721.sol";
import {SupplyStatus, SupplyRightData, DefaultType} from "../src/SupplyTypes.sol";

contract SupplyRightNFTTest is SupplyRightFixture {
    function test_RegistrarMintsSupplyRight() public {
        uint256 id = _mintRight();
        SupplyRightData memory r = rights.getSupplyRight(id);
        assertEq(rights.ownerOf(id), buyer);
        assertEq(r.buyer, buyer);
        assertEq(r.contractValue, CONTRACT_VALUE);
        assertEq(r.orderedQuantity, ORDERED);
        assertEq(uint8(r.status), uint8(SupplyStatus.Registered));
        assertEq(rights.totalMinted(), 1);
        assertEq(rights.undeliveredValue(id, DELIVERED), SHORTFALL_LOSS);
    }

    function test_RevertWhen_UnauthorizedMint() public {
        SupplyRightNFT.MintParams memory p = _mintParams();
        bytes32 role = rights.REGISTRAR_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, role));
        vm.prank(outsider);
        rights.mintSupplyRight(p);

        // A buyer cannot mint its own supply right either.
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, buyer, role));
        vm.prank(buyer);
        rights.mintSupplyRight(p);
    }

    function test_RevertWhen_BuyerNotOnboarded() public {
        SupplyRightNFT.MintParams memory p = _mintParams();
        p.buyer = outsider;
        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.BuyerNotAuthorized.selector, outsider));
        vm.prank(registrar);
        rights.mintSupplyRight(p);
    }

    function test_RevertWhen_DuplicatePurchaseOrder() public {
        SupplyRightNFT.MintParams memory p = _mintParams();
        vm.prank(registrar);
        uint256 id = rights.mintSupplyRight(p);
        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.DuplicatePurchaseOrder.selector, id));
        vm.prank(registrar);
        rights.mintSupplyRight(p);
    }

    function test_RevertWhen_InvalidMintParams() public {
        SupplyRightNFT.MintParams memory p = _mintParams();
        p.deliveryDeadline = uint64(block.timestamp);
        vm.expectRevert(SupplyRightNFT.InvalidParams.selector);
        vm.prank(registrar);
        rights.mintSupplyRight(p);

        p = _mintParams();
        p.agreementHash = bytes32(0);
        vm.expectRevert(SupplyRightNFT.InvalidParams.selector);
        vm.prank(registrar);
        rights.mintSupplyRight(p);
    }

    function test_ActivateRecordsSupplierAcknowledgement() public {
        uint256 id = _mintActiveRight();
        SupplyRightData memory r = rights.getSupplyRight(id);
        assertEq(uint8(r.status), uint8(SupplyStatus.Active));
        assertEq(r.supplierAckHash, keccak256("supplier-ack"));

        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.InvalidStatus.selector, SupplyStatus.Active));
        vm.prank(registrar);
        rights.activate(id, keccak256("again"));
    }

    function test_OnlyProtocolDrivesLifecycle() public {
        uint256 id = _mintActiveRight();
        vm.expectRevert(SupplyRightNFT.NotProtocol.selector);
        vm.prank(admin);
        rights.setStatusByProtocol(id, SupplyStatus.Defaulted, bytes32("x"));

        vm.expectRevert(SupplyRightNFT.NotProtocol.selector);
        vm.prank(outsider);
        rights.linkProtection(id, 99);

        vm.expectRevert(SupplyRightNFT.NotProtocol.selector);
        vm.prank(outsider);
        rights.recordDelivery(id, 1, bytes32("x"));
    }

    function test_ProtocolBindingIsOneTime() public {
        vm.expectRevert(SupplyRightNFT.AlreadyBound.selector);
        vm.prank(admin);
        rights.bindProtocol(outsider, outsider);
    }

    function test_TransfersRestrictedUnlessAuthorized() public {
        uint256 id = _mintRight();
        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, id, outsider));
        vm.prank(buyer);
        rights.transferFrom(buyer, outsider, id);

        vm.prank(registrar);
        rights.authorizeTransfer(id, outsider, keccak256("assignment-agreement"));
        vm.prank(buyer);
        rights.transferFrom(buyer, outsider, id);
        assertEq(rights.ownerOf(id), outsider);

        // Authorization is single-use.
        vm.expectRevert(abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, id, buyer));
        vm.prank(outsider);
        rights.transferFrom(outsider, buyer, id);
    }

    function test_RecordDeliveryIsMonotonic() public {
        uint256 id = _mintActiveRight();
        vm.prank(registrar);
        rights.recordDelivery(id, 20 * MT, keccak256("dn-1"));
        vm.expectRevert(SupplyRightNFT.InvalidQuantity.selector);
        vm.prank(registrar);
        rights.recordDelivery(id, 10 * MT, keccak256("dn-2"));
        vm.expectRevert(SupplyRightNFT.InvalidQuantity.selector);
        vm.prank(registrar);
        rights.recordDelivery(id, ORDERED + 1, keccak256("dn-3"));
    }

    // ------------------------------------------------------------------
    // Finalization rules
    // ------------------------------------------------------------------

    function test_FulfilledAgreementCanCloseAndRelease() public {
        (uint256 id, uint256 pid) = _setupProtected();
        vm.prank(registrar);
        rights.markFulfilled(id, keccak256("final-delivery-note"));
        assertEq(uint8(rights.getSupplyRight(id).status), uint8(SupplyStatus.Fulfilled));
        assertEq(rights.getSupplyRight(id).deliveredQuantity, ORDERED);

        // Fulfilled supply rights cannot be claimed against.
        _passDeadline();
        vm.expectRevert();
        vm.prank(buyer);
        claims.submitClaim(pid, DefaultType.Partial, 1, 1, keccak256("e"));

        vm.prank(registrar);
        rights.close(id, keccak256("closing-memo"));
        assertEq(uint8(rights.getSupplyRight(id).status), uint8(SupplyStatus.Closed));
    }

    function test_RevertWhen_ClosingActiveOrAssessedAgreement() public {
        (uint256 id, uint256 pid) = _setupProtected();
        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.InvalidStatus.selector, SupplyStatus.Active));
        vm.prank(registrar);
        rights.close(id, keccak256("closing-memo"));

        _passDeadline();
        _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.InvalidStatus.selector, SupplyStatus.UnderAssessment));
        vm.prank(registrar);
        rights.close(id, keccak256("closing-memo"));

        vm.expectRevert(abi.encodeWithSelector(SupplyRightNFT.InvalidStatus.selector, SupplyStatus.UnderAssessment));
        vm.prank(registrar);
        rights.markFulfilled(id, keccak256("dn"));
    }

    function test_RevertWhen_ClosingDuringAppealWindow() public {
        (uint256 id, uint256 pid) = _setupProtected();
        _passDeadline();
        uint256 c1 = _submitPartial(pid, DELIVERED, SHORTFALL_LOSS);
        _approve(c1, DELIVERED, 30 * ETH);
        claims.settleClaim(c1);
        // Second claim rejected -> appeal window open -> closure blocked.
        uint256 c2 = _submitPartial(pid, DELIVERED, 10 * ETH);
        vm.prank(verifier);
        claims.rejectClaim(c2, keccak256("reason"), "Insufficient evidence");
        vm.expectRevert(SupplyRightNFT.ClaimActivityPending.selector);
        vm.prank(registrar);
        rights.close(id, keccak256("closing-memo"));

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(registrar);
        rights.close(id, keccak256("closing-memo"));
        assertEq(uint8(rights.getSupplyRight(id).status), uint8(SupplyStatus.Closed));
    }

    function test_TokenURIDoesNotRevert() public {
        uint256 id = _mintRight();
        string memory uri = rights.tokenURI(id);
        assertGt(bytes(uri).length, 100);
    }
}
