// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {DefaultType, ProtectionPosition} from "../src/SupplyTypes.sol";

/// @notice Demo phase 2 - FICTIONAL case study. Run after case A's delivery deadline has passed.
///           1. buyer files a partial-default claim (10 of 50 MT delivered, 80 ETH loss claimed)
///           2. independent verifier approves an eligible loss of 80 ETH -> 16 ETH payout (20%)
///           3. atomic settlement: 16 ETH to buyer + Recovery Claim NFT to provider in one tx
///
/// Signers: buyer, verifier - Anvil keys locally, keystores via --account on Sepolia.
/// Env: DEMO_STOP_AFTER = submit | approve | settle (default settle) - stop early to finish live in the UI
contract SeedDemoClaim is ScriptBase {
    uint256 internal constant MT = 1e3;

    function run() external {
        string memory stopAfter = vm.envOr("DEMO_STOP_AFTER", string("settle"));

        SupplyClaimManager claims = SupplyClaimManager(_readDeployment("claimManager"));
        SupplyProtectionVault vault = SupplyProtectionVault(_readDeployment("vault"));

        string memory demo = vm.readFile(_demoPath());
        uint256 protectionId = vm.parseJsonUint(demo, ".protectionId");
        uint256 deadlineA = vm.parseJsonUint(demo, ".deadlineA");
        require(
            block.timestamp > deadlineA,
            "Delivery deadline not reached yet. Wait (Sepolia) or locally: cast rpc evm_increaseTime 600 && cast rpc evm_mine"
        );

        _startBroadcastAs(Role.Buyer);
        uint256 claimId = claims.submitClaim(
            protectionId, DefaultType.Partial, 80 ether, 10 * MT, _docHash("CLAIM-EVIDENCE-0417.txt")
        );
        vm.stopBroadcast();
        _log("Buyer", "submitted partial-default claim");
        console2.log("Claim id:", claimId);
        if (_eq(stopAfter, "submit")) return;

        _startBroadcastAs(Role.Verifier);
        claims.approveClaim(claimId, 10 * MT, 80 ether, _docHash("VERIFIER-REPORT-0417.txt"));
        vm.stopBroadcast();
        _log("Verifier", "approved eligible loss of 80 ETH (payout 16 ETH)");
        if (_eq(stopAfter, "approve")) return;

        if (claims.settlementDelay() > 0) {
            console2.log("Settlement delay active; settle later from the Claims Center.");
            return;
        }
        address buyer = _wallet(Role.Buyer);
        uint256 before = buyer.balance;
        _startBroadcastAs(Role.Verifier); // permissionless; the buyer pays no gas so the payout shows exactly
        uint256 recoveryId = claims.settleClaim(claimId);
        vm.stopBroadcast();

        ProtectionPosition memory p = vault.getProtection(protectionId);
        _log("Settlement", "atomic payout + Recovery Claim NFT complete");
        console2.log("Buyer received (wei):", buyer.balance - before);
        console2.log("Recovery Claim NFT id:", recoveryId);
        console2.log("Remaining locked coverage (wei):", p.lockedAmount);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
