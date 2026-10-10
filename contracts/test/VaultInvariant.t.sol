// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SupplyRightFixture} from "./Fixture.t.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {ProtectionPosition, DefaultType, SupplyStatus} from "../src/SupplyTypes.sol";

/// @notice Drives random sequences of deposits, withdrawals, protections, claims, settlements and
///         releases against the real contracts.
contract VaultHandler is Test {
    SupplyRightNFT internal rights;
    SupplyProtectionVault internal vault;
    SupplyClaimManager internal claims;
    address internal registrar;
    address internal buyer;
    address internal provider;
    address internal verifier;

    uint256 public ghostPaidToBuyer;
    uint256[] public protectionIds;
    uint256 internal nonce;

    constructor(
        SupplyRightNFT rights_,
        SupplyProtectionVault vault_,
        SupplyClaimManager claims_,
        address registrar_,
        address buyer_,
        address provider_,
        address verifier_
    ) {
        rights = rights_;
        vault = vault_;
        claims = claims_;
        registrar = registrar_;
        buyer = buyer_;
        provider = provider_;
        verifier = verifier_;
    }

    function protectionCount() external view returns (uint256) {
        return protectionIds.length;
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 100 ether);
        vm.prank(provider);
        vault.deposit{value: amount}();
    }

    function withdraw(uint256 amount) external {
        uint256 free = vault.freeCollateral(provider);
        if (free == 0) return;
        amount = bound(amount, 1, free);
        vm.prank(provider);
        vault.withdraw(amount);
    }

    function createProtection(uint256 value, uint256 coverage, uint16 bps) external {
        value = bound(value, 1 ether, 500 ether);
        coverage = bound(coverage, 1, value);
        bps = uint16(bound(bps, 1, 10_000));
        nonce++;
        uint64 deadline = uint64(block.timestamp + 1 days);
        vm.prank(registrar);
        uint256 id = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: keccak256(abi.encode("inv-po", nonce)),
                agreementHash: keccak256(abi.encode("inv-ag", nonce)),
                supplierRefHash: keccak256("supplier"),
                contractValue: value,
                orderedQuantity: 1_000,
                deliveryDeadline: deadline,
                unit: bytes8("MT")
            })
        );
        vm.prank(registrar);
        rights.activate(id, keccak256("ack"));
        vm.prank(buyer);
        uint256 req = vault.requestProtection(id, provider, coverage, bps, deadline + 30 days, keccak256("terms"));
        uint256 free = vault.freeCollateral(provider);
        vm.prank(provider);
        uint256 pid =
            vault.fundAndApproveProtection{value: coverage > free ? coverage - free : 0}(req, keccak256("memo"));
        protectionIds.push(pid);
    }

    function claimAndSettle(uint256 seed, uint256 delivered, uint256 lossShare) external {
        if (protectionIds.length == 0) return;
        uint256 pid = protectionIds[seed % protectionIds.length];
        ProtectionPosition memory p = vault.getProtection(pid);
        if (p.lockedAmount == 0 || p.claimOpen) return;
        SupplyStatus s = rights.getSupplyRight(p.supplyRightId).status;
        if (s != SupplyStatus.Active && s != SupplyStatus.Defaulted) return;
        uint64 deadline = rights.getSupplyRight(p.supplyRightId).deliveryDeadline;
        if (block.timestamp <= deadline) vm.warp(deadline + 1);
        if (block.timestamp > p.expiresAt) return;

        uint256 minDelivered = rights.getSupplyRight(p.supplyRightId).deliveredQuantity;
        delivered = bound(delivered, minDelivered, 999);
        uint256 cap = claims.remainingLossCap(p.supplyRightId, delivered);
        if (cap == 0) return;
        uint256 loss = bound(lossShare, 1, cap);
        DefaultType t = delivered == 0 ? DefaultType.Complete : DefaultType.Partial;
        nonce++;
        vm.prank(buyer);
        uint256 claimId = claims.submitClaim(pid, t, loss, delivered, keccak256(abi.encode("inv-ev", nonce)));
        if (vault.quotePayout(pid, loss) == 0) {
            vm.prank(verifier);
            claims.rejectClaim(claimId, keccak256("zero"), "No compensable amount");
            return;
        }
        vm.prank(verifier);
        claims.approveClaim(claimId, delivered, loss, keccak256(abi.encode("inv-rep", nonce)));
        uint256 before = buyer.balance;
        claims.settleClaim(claimId);
        ghostPaidToBuyer += buyer.balance - before;
    }

    function expireAndRelease(uint256 seed) external {
        if (protectionIds.length == 0) return;
        uint256 pid = protectionIds[seed % protectionIds.length];
        ProtectionPosition memory p = vault.getProtection(pid);
        if (p.claimOpen) return;
        uint256 appealUntil = claims.appealDeadlineOf(pid);
        uint256 target = p.expiresAt > appealUntil ? p.expiresAt : appealUntil;
        if (block.timestamp <= target) vm.warp(target + 1);
        try vault.releaseCollateral(pid) {} catch {}
    }
}

contract VaultInvariantTest is SupplyRightFixture {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(rights, vault, claims, registrar, buyer, provider, verifier);
        vm.deal(provider, 1_000_000 ether); // enough native ETH for long runs
        targetContract(address(handler));
    }

    /// Vault always holds at least the free + locked collateral it accounts for.
    function invariant_VaultIsSolvent() public view {
        assertGe(address(vault).balance, vault.totalFreeCollateral() + vault.totalLockedCollateral());
    }

    /// Every payout reached the beneficiary, and accounting matches.
    function invariant_PayoutsAccounted() public view {
        assertEq(vault.totalPaidOut(), handler.ghostPaidToBuyer());
    }

    /// No protection ever paid more than its coverage, and paid + locked + released == coverage.
    function invariant_CoverageConserved() public view {
        uint256 n = handler.protectionCount();
        for (uint256 i = 0; i < n; i++) {
            ProtectionPosition memory p = vault.getProtection(handler.protectionIds(i));
            assertLe(p.paidAmount, p.coverageAmount);
            assertEq(p.paidAmount + p.lockedAmount + p.releasedAmount, p.coverageAmount);
        }
    }
}
