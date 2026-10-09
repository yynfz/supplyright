// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {MockETH} from "../src/MockETH.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {DefaultType, ProtectionPosition} from "../src/SupplyTypes.sol";

/// @notice Demo phase 2 - FICTIONAL case study. Run after case A's delivery deadline has passed.
///           1. buyer files a partial-default claim (10 of 50 MT delivered, 80 mETH loss claimed)
///           2. independent verifier approves an eligible loss of 80 mETH -> 16 mETH payout (20%)
///           3. atomic settlement: 16 mETH to buyer + Recovery Claim NFT to provider in one tx
///
/// Env: BUYER_PRIVATE_KEY, VERIFIER_PRIVATE_KEY (Anvil defaults locally)
///      DEMO_STOP_AFTER = submit | approve | settle (default settle) - stop early to finish live in the UI
contract SeedDemoClaim is ScriptBase {
    uint256 internal constant MT = 1e3;

    function run() external {
        uint256 buyerKey = _key("BUYER_PRIVATE_KEY", ANVIL_KEY_1);
        uint256 verifierKey = _key("VERIFIER_PRIVATE_KEY", ANVIL_KEY_3);
        string memory stopAfter = vm.envOr("DEMO_STOP_AFTER", string("settle"));

        SupplyClaimManager claims = SupplyClaimManager(_readDeployment("claimManager"));
        SupplyProtectionVault vault = SupplyProtectionVault(_readDeployment("vault"));
        MockETH token = MockETH(_readDeployment("settlementToken"));

        string memory demo = vm.readFile(_demoPath());
        uint256 protectionId = vm.parseJsonUint(demo, ".protectionId");
        uint256 deadlineA = vm.parseJsonUint(demo, ".deadlineA");
        require(
            block.timestamp > deadlineA,
            "Delivery deadline not reached yet. Wait (Sepolia) or advance time locally: cast rpc evm_increaseTime 600"
        );

        vm.startBroadcast(buyerKey);
        uint256 claimId = claims.submitClaim(
            protectionId, DefaultType.Partial, 80 ether, 10 * MT, _docHash("CLAIM-EVIDENCE-0417.txt")
        );
        vm.stopBroadcast();
        _log("Buyer", "submitted partial-default claim");
        console2.log("Claim id:", claimId);
        if (_eq(stopAfter, "submit")) return;

        vm.startBroadcast(verifierKey);
        claims.approveClaim(claimId, 10 * MT, 80 ether, _docHash("VERIFIER-REPORT-0417.txt"));
        vm.stopBroadcast();
        _log("Verifier", "approved eligible loss of 80 mETH (payout 16 mETH)");
        if (_eq(stopAfter, "approve")) return;

        if (claims.settlementDelay() > 0) {
            console2.log("Settlement delay active; settle later from the Claims Center.");
            return;
        }
        address buyer = vm.addr(buyerKey);
        uint256 before = token.balanceOf(buyer);
        vm.startBroadcast(buyerKey);
        uint256 recoveryId = claims.settleClaim(claimId);
        vm.stopBroadcast();

        ProtectionPosition memory p = vault.getProtection(protectionId);
        _log("Settlement", "atomic payout + Recovery Claim NFT complete");
        console2.log("Buyer received (wei):", token.balanceOf(buyer) - before);
        console2.log("Recovery Claim NFT id:", recoveryId);
        console2.log("Remaining locked coverage (wei):", p.lockedAmount);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
