// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightRoles} from "./lib/SupplyRightRoles.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RestrictedTransfer721} from "../src/base/RestrictedTransfer721.sol";
import {ProtectionTerms, RecoveryClaimData, ClaimRecord, ClaimStatus, DefaultType} from "../src/SupplyTypes.sol";

/// @notice Negative / security checks against a LIVE deployment, executed as a forked simulation: every call is
///         evaluated against the deployed bytecode and current onchain state, but nothing is broadcast and no
///         gas is spent (never pass --broadcast; the script refuses).
///
///         Covers unauthorized role access, unauthorized minting, unauthorized claim approval, double claim,
///         insufficient escrow, invalid NFT transfers, double settlement, unauthorized admin actions and atomic
///         settlement rollback. The checks that need a settled claim use the E2E case (E2E_RUN_ID).
///
///   forge script script/CheckPermissions.s.sol:CheckPermissions --rpc-url sepolia
contract CheckPermissions is ScriptBase {
    SupplyRightRoles.Protocol internal p;
    SupplyRightRoles.Wallets internal w;
    address internal outsider = address(0xBEEF0001);
    uint256 internal passed;
    uint256 internal failed;

    function run() external {
        require(!_broadcasting(), "CheckPermissions is simulation-only; run it without --broadcast");
        p = _protocol();
        w = _roleWallets();
        console2.log("=== SupplyRight permission checks (forked simulation, no transactions), chain", block.chainid);
        _requireRoleMatrix(p, w);

        _unauthorizedRoleAccess();
        _unauthorizedMinting();
        _unauthorizedAdmin();
        _insufficientEscrow();

        string memory runId = vm.envOr("E2E_RUN_ID", string("SEPOLIA-E2E-001"));
        uint256 rightId = p.rights.tokenIdByPoRef(keccak256(abi.encodePacked("SupplyRight/", runId, "/PO")));
        uint256[] memory ids = rightId == 0 ? new uint256[](0) : p.claims.claimsOfSupplyRight(rightId);
        if (ids.length != 0 && p.claims.getClaim(ids[ids.length - 1]).status == ClaimStatus.Settled) {
            _settledCase(rightId, ids[ids.length - 1], runId);
        } else {
            console2.log("  (skipped: claim / settlement / NFT checks need the settled E2E case", runId, ")");
        }
        _atomicRollback();

        console2.log("");
        console2.log("checks passed:", passed);
        console2.log("checks failed:", failed);
        require(failed == 0, "permission checks failed");
    }

    // ---------------------------------------------------------------------

    function _unauthorizedRoleAccess() private {
        console2.log("-- unauthorized role access");
        bytes32 providerRole = p.vault.PROVIDER_ROLE();
        address[3] memory notProviders = [w.buyer, w.verifier, w.admin];
        string[3] memory names = ["buyer", "verifier", "admin"];
        for (uint256 i = 0; i < 3; i++) {
            _expect(
                string.concat(names[i], " cannot deposit escrow"),
                notProviders[i],
                address(p.vault),
                0.001 ether,
                abi.encodeCall(SupplyProtectionVault.deposit, ()),
                _unauthorized(notProviders[i], providerRole)
            );
        }
    }

    function _unauthorizedMinting() private {
        console2.log("-- unauthorized minting");
        bytes32 registrarRole = p.rights.REGISTRAR_ROLE();
        address[4] memory notRegistrars = [w.buyer, w.provider, w.verifier, outsider];
        string[4] memory names = ["buyer", "provider", "verifier", "outsider"];
        for (uint256 i = 0; i < 4; i++) {
            _expect(
                string.concat(names[i], " cannot mint a SupplyRight NFT"),
                notRegistrars[i],
                address(p.rights),
                0,
                abi.encodeCall(SupplyRightNFT.mintSupplyRight, (_mintParams("forged-po"))),
                _unauthorized(notRegistrars[i], registrarRole)
            );
        }
        ProtectionTerms memory t;
        t.beneficiary = w.buyer;
        _expect(
            "admin cannot mint a Protection NFT directly",
            w.admin,
            address(p.protection),
            0,
            abi.encodeCall(ProtectionNFT.mint, (type(uint128).max, t)),
            abi.encodeWithSelector(ProtectionNFT.NotVault.selector)
        );
        RecoveryClaimData memory d;
        _expect(
            "admin cannot mint a Recovery Claim NFT directly",
            w.admin,
            address(p.recovery),
            0,
            abi.encodeCall(RecoveryClaimNFT.mintRecoveryClaim, (w.provider, d)),
            abi.encodeWithSelector(RecoveryClaimNFT.NotClaimManager.selector)
        );
    }

    function _unauthorizedAdmin() private {
        console2.log("-- unauthorized admin actions");
        bytes32 adminRole = SupplyRightRoles.DEFAULT_ADMIN_ROLE;
        address[3] memory nonAdmins = [w.buyer, w.provider, w.verifier];
        string[3] memory names = ["buyer", "provider", "verifier"];
        for (uint256 i = 0; i < 3; i++) {
            _expect(
                string.concat(names[i], " cannot grant VERIFIER_ROLE"),
                nonAdmins[i],
                address(p.claims),
                0,
                abi.encodeCall(IAccessControl.grantRole, (p.claims.VERIFIER_ROLE(), nonAdmins[i])),
                _unauthorized(nonAdmins[i], adminRole)
            );
            _expect(
                string.concat(names[i], " cannot change the settlement delay"),
                nonAdmins[i],
                address(p.claims),
                0,
                abi.encodeCall(SupplyClaimManager.setSettlementDelay, (1 days)),
                _unauthorized(nonAdmins[i], adminRole)
            );
        }
        _expect(
            "admin cannot re-point the vault's claim manager (one-time binding)",
            w.admin,
            address(p.vault),
            0,
            abi.encodeCall(SupplyProtectionVault.bindClaimManager, (w.admin)),
            abi.encodeWithSelector(SupplyProtectionVault.AlreadyBound.selector)
        );
    }

    /// Fresh right minted in simulation only; the provider approves without enough escrow.
    function _insufficientEscrow() private {
        console2.log("-- insufficient escrow");
        vm.prank(w.admin);
        uint256 id = p.rights.mintSupplyRight(_mintParams("escrow-check"));
        vm.prank(w.admin);
        p.rights.activate(id, keccak256("ack"));
        vm.prank(w.buyer);
        uint256 req = p.vault.requestProtection(
            id, w.provider, 0.01 ether, 2_000, uint64(block.timestamp + 31 days), keccak256("terms")
        );
        uint256 free = p.vault.freeCollateral(w.provider);
        _expect(
            "provider cannot activate protection without escrow",
            w.provider,
            address(p.vault),
            0,
            abi.encodeCall(SupplyProtectionVault.approveProtection, (req, keccak256("memo"))),
            abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, free, 0.01 ether)
        );
        _expect(
            "provider cannot activate protection with too little ETH",
            w.provider,
            address(p.vault),
            0.005 ether,
            abi.encodeCall(SupplyProtectionVault.fundAndApproveProtection, (req, keccak256("memo"))),
            abi.encodeWithSelector(SupplyProtectionVault.InsufficientFreeCollateral.selector, free + 0.005 ether, 0.01 ether)
        );
        vm.deal(w.provider, w.provider.balance + 0.01 ether);
        vm.prank(w.provider);
        (bool ok,) = address(p.vault).call{value: 0.01 ether}("");
        _record("vault refuses plain ETH transfers", !ok);
    }

    function _settledCase(uint256 rightId, uint256 claimId, string memory runId) private {
        ClaimRecord memory c = p.claims.getClaim(claimId);
        bytes32 verifierRole = p.claims.VERIFIER_ROLE();

        console2.log("-- unauthorized claim approval");
        address[3] memory notVerifiers = [w.buyer, w.provider, w.admin];
        string[3] memory names = ["buyer", "provider", "admin"];
        for (uint256 i = 0; i < 3; i++) {
            _expect(
                string.concat(names[i], " cannot approve a claim"),
                notVerifiers[i],
                address(p.claims),
                0,
                abi.encodeCall(SupplyClaimManager.approveClaim, (claimId, 0, 1, keccak256("fake"))),
                _unauthorized(notVerifiers[i], verifierRole)
            );
        }
        _expect(
            "provider cannot file a claim on the buyer's protection",
            w.provider,
            address(p.claims),
            0,
            abi.encodeCall(
                SupplyClaimManager.submitClaim, (c.protectionId, DefaultType.Partial, 1, 10_000, keccak256("x"))
            ),
            abi.encodeWithSelector(SupplyClaimManager.NotBeneficiary.selector)
        );

        console2.log("-- double claim / double settlement");
        _expect(
            "buyer cannot reuse the settled claim's evidence",
            w.buyer,
            address(p.claims),
            0,
            abi.encodeCall(
                SupplyClaimManager.submitClaim,
                (c.protectionId, DefaultType.Partial, 1, c.verifiedDeliveredQuantity, c.evidenceHash)
            ),
            abi.encodeWithSelector(SupplyClaimManager.EvidenceAlreadyUsed.selector)
        );
        uint256 cap = p.claims.remainingLossCap(rightId, c.verifiedDeliveredQuantity);
        _expect(
            "buyer cannot claim the already compensated loss again",
            w.buyer,
            address(p.claims),
            0,
            abi.encodeCall(
                SupplyClaimManager.submitClaim,
                (c.protectionId, DefaultType.Partial, c.approvedLoss, c.verifiedDeliveredQuantity, keccak256(bytes(runId)))
            ),
            abi.encodeWithSelector(SupplyClaimManager.ExcessiveLoss.selector, c.approvedLoss, cap)
        );
        _expect(
            "claim cannot be settled twice",
            outsider,
            address(p.claims),
            0,
            abi.encodeCall(SupplyClaimManager.settleClaim, (claimId)),
            abi.encodeWithSelector(SupplyClaimManager.InvalidClaimStatus.selector, ClaimStatus.Settled)
        );

        console2.log("-- NFT transfer rules");
        _expect(
            "SupplyRight NFT cannot move without a registrar-authorized assignment",
            w.buyer,
            address(p.rights),
            0,
            abi.encodeWithSignature("transferFrom(address,address,uint256)", w.buyer, outsider, rightId),
            abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, rightId, outsider)
        );
        _expect(
            "Protection NFT is non-transferable",
            w.buyer,
            address(p.protection),
            0,
            abi.encodeWithSignature("transferFrom(address,address,uint256)", w.buyer, outsider, c.protectionId),
            abi.encodeWithSelector(ProtectionNFT.NonTransferable.selector)
        );
        _expect(
            "Recovery Claim NFT cannot move without authorization",
            w.provider,
            address(p.recovery),
            0,
            abi.encodeWithSignature("transferFrom(address,address,uint256)", w.provider, outsider, c.recoveryTokenId),
            abi.encodeWithSelector(RestrictedTransfer721.TransferNotAuthorized.selector, c.recoveryTokenId, outsider)
        );
        _expect(
            "provider cannot authorize transfers (TRANSFER_APPROVER_ROLE)",
            w.provider,
            address(p.recovery),
            0,
            abi.encodeCall(RestrictedTransfer721.authorizeTransfer, (c.recoveryTokenId, outsider, keccak256("a"))),
            _unauthorized(w.provider, p.recovery.TRANSFER_APPROVER_ROLE())
        );
    }

    /// Full claim built in simulation; the beneficiary then refuses ETH, so settlement must revert as a whole.
    function _atomicRollback() private {
        console2.log("-- atomic settlement rollback");
        vm.prank(w.admin);
        uint256 id = p.rights.mintSupplyRight(_mintParams("rollback-check"));
        vm.startPrank(w.admin);
        p.rights.activate(id, keccak256("ack"));
        p.rights.recordDelivery(id, 10_000, keccak256("dn"));
        vm.stopPrank();
        vm.prank(w.buyer);
        uint256 req =
            p.vault.requestProtection(id, w.provider, 0.01 ether, 2_000, uint64(block.timestamp + 31 days), keccak256("t"));
        vm.deal(w.provider, w.provider.balance + 0.01 ether);
        vm.prank(w.provider);
        uint256 pid = p.vault.fundAndApproveProtection{value: 0.01 ether}(req, keccak256("m"));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(w.buyer);
        uint256 claimId =
            p.claims.submitClaim(pid, DefaultType.Partial, 0.04 ether, 10_000, keccak256(abi.encode("rollback-ev", id)));
        vm.prank(w.verifier);
        p.claims.approveClaim(claimId, 10_000, 0.04 ether, keccak256("r"));

        uint256 vaultBefore = address(p.vault).balance;
        uint256 minted = p.recovery.totalMinted();
        bytes memory buyerCode = w.buyer.code;
        vm.etch(w.buyer, hex"60006000fd"); // PUSH1 0 PUSH1 0 REVERT: refuses any call, including plain ETH
        (bool ok,) = address(p.claims).call(abi.encodeCall(SupplyClaimManager.settleClaim, (claimId)));
        vm.etch(w.buyer, buyerCode);
        _record(
            "settlement reverts entirely when the ETH payout fails",
            !ok && p.claims.getClaim(claimId).status == ClaimStatus.Approved && address(p.vault).balance == vaultBefore
                && p.recovery.totalMinted() == minted
        );
    }

    // ---------------------------------------------------------------------

    function _mintParams(string memory tag) private view returns (SupplyRightNFT.MintParams memory) {
        return SupplyRightNFT.MintParams({
            buyer: w.buyer,
            poRefHash: keccak256(abi.encode("CheckPermissions", tag, block.number)),
            agreementHash: keccak256("agreement"),
            supplierRefHash: keccak256("supplier"),
            contractValue: 0.05 ether,
            orderedQuantity: 50_000,
            deliveryDeadline: uint64(block.timestamp + 1 hours),
            unit: bytes8("MT")
        });
    }

    function _unauthorized(address account, bytes32 role) private pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role);
    }

    function _expect(
        string memory label,
        address caller,
        address target,
        uint256 value,
        bytes memory data,
        bytes memory expectedRevert
    ) private {
        if (value > 0) vm.deal(caller, caller.balance + value);
        vm.prank(caller);
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        _record(label, !ok && keccak256(ret) == keccak256(expectedRevert));
    }

    function _record(string memory label, bool pass) private {
        if (pass) passed++;
        else failed++;
        console2.log(pass ? "  PASS" : "  FAIL", label);
    }
}
