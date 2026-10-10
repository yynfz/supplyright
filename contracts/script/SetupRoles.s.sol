// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";

/// @notice Assigns roles on-chain for the 4 SupplyRight participants.
///         Must be run by an account holding DEFAULT_ADMIN_ROLE (the deployer / admin).
///
/// Inputs (environment variables or config fallback):
///   ADMIN_KEY or DEPLOYER_PRIVATE_KEY
///   BUYER_ADDRESS    (supplyright-buyer)
///   PROVIDER_ADDRESS (supplyright-provider)
///   VERIFIER_ADDRESS (supplyright-verifier)
///   NEW_ADMIN_ADDRESS (supplyright-admin)
contract SetupRoles is ScriptBase {
    function run() external {
        uint256 adminKey = _key("DEPLOYER_PRIVATE_KEY", ANVIL_KEY_0);
        address adminCaller = vm.addr(adminKey);

        address buyer = vm.envOr("BUYER_ADDRESS", address(0x6ACF72e4047d26b1C0AA6292BD38B03E9a70580B));
        address provider = vm.envOr("PROVIDER_ADDRESS", address(0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066));
        address verifier = vm.envOr("VERIFIER_ADDRESS", address(0x4481A845dFb7855dC1e0946C26965f4a856B12dD));
        address newAdmin = vm.envOr("ADMIN_ADDRESS", address(0x3a570002A98Bbe4cC7A182ccdbb5EF0dc2633CBc));

        console2.log("Assigning roles from caller:", adminCaller);
        console2.log("  Buyer    :", buyer);
        console2.log("  Provider :", provider);
        console2.log("  Verifier :", verifier);
        console2.log("  Admin    :", newAdmin);

        SupplyRightNFT rights = SupplyRightNFT(_readDeployment("supplyRightNFT"));
        SupplyProtectionVault vault = SupplyProtectionVault(_readDeployment("vault"));
        SupplyClaimManager claims = SupplyClaimManager(_readDeployment("claimManager"));
        RecoveryClaimNFT recovery = RecoveryClaimNFT(_readDeployment("recoveryClaimNFT"));

        vm.startBroadcast(adminKey);

        // 1. Buyer Role
        if (!rights.hasRole(rights.BUYER_ROLE(), buyer)) {
            rights.grantRole(rights.BUYER_ROLE(), buyer);
            console2.log("Granted BUYER_ROLE to", buyer);
        }

        // 2. Provider Role
        if (!vault.hasRole(vault.PROVIDER_ROLE(), provider)) {
            vault.grantRole(vault.PROVIDER_ROLE(), provider);
            console2.log("Granted PROVIDER_ROLE to", provider);
        }

        // 3. Verifier Role
        if (!claims.hasRole(claims.VERIFIER_ROLE(), verifier)) {
            claims.grantRole(claims.VERIFIER_ROLE(), verifier);
            console2.log("Granted VERIFIER_ROLE to", verifier);
        }

        // 4. Admin & Registrar Roles to new supplyright-admin
        if (!rights.hasRole(rights.REGISTRAR_ROLE(), newAdmin)) {
            rights.grantRole(rights.REGISTRAR_ROLE(), newAdmin);
            console2.log("Granted REGISTRAR_ROLE to", newAdmin);
        }
        if (!rights.hasRole(rights.TRANSFER_APPROVER_ROLE(), newAdmin)) {
            rights.grantRole(rights.TRANSFER_APPROVER_ROLE(), newAdmin);
            console2.log("Granted TRANSFER_APPROVER_ROLE on rights to", newAdmin);
        }
        if (!recovery.hasRole(recovery.TRANSFER_APPROVER_ROLE(), newAdmin)) {
            recovery.grantRole(recovery.TRANSFER_APPROVER_ROLE(), newAdmin);
            console2.log("Granted TRANSFER_APPROVER_ROLE on recovery to", newAdmin);
        }
        if (!rights.hasRole(rights.DEFAULT_ADMIN_ROLE(), newAdmin)) {
            rights.grantRole(rights.DEFAULT_ADMIN_ROLE(), newAdmin);
            console2.log("Granted DEFAULT_ADMIN_ROLE on rights to", newAdmin);
        }
        if (!vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), newAdmin)) {
            vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), newAdmin);
            console2.log("Granted DEFAULT_ADMIN_ROLE on vault to", newAdmin);
        }
        if (!claims.hasRole(claims.DEFAULT_ADMIN_ROLE(), newAdmin)) {
            claims.grantRole(claims.DEFAULT_ADMIN_ROLE(), newAdmin);
            console2.log("Granted DEFAULT_ADMIN_ROLE on claims to", newAdmin);
        }
        if (!recovery.hasRole(recovery.DEFAULT_ADMIN_ROLE(), newAdmin)) {
            recovery.grantRole(recovery.DEFAULT_ADMIN_ROLE(), newAdmin);
            console2.log("Granted DEFAULT_ADMIN_ROLE on recovery to", newAdmin);
        }

        vm.stopBroadcast();
        console2.log("On-chain role configuration successfully finished.");
    }
}

