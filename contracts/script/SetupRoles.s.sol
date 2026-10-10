// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightRoles} from "./lib/SupplyRightRoles.sol";

/// @notice Idempotently (re)assigns the four-wallet role matrix on an existing deployment and verifies it
///         onchain. Roles already held are skipped, so re-running sends no transactions.
///
///         The caller must hold DEFAULT_ADMIN_ROLE on all five contracts: the deployer right after
///         deployment, or the supplyright-admin wallet afterwards.
///
/// Sepolia:
///   forge script script/SetupRoles.s.sol:SetupRoles --rpc-url sepolia --broadcast --slow \
///     --account supplyright-sepolia-deployer.json --sender <deployer address>
///
/// Env: SETUP_ROLES_AS = deployer | admin           (default deployer)
///      RENOUNCE_DEPLOYER_ADMIN = true               (optional: after the matrix holds, the deployer gives up
///                                                    DEFAULT_ADMIN_ROLE so the admin wallet is the only admin)
contract SetupRoles is ScriptBase {
    function run() external {
        SupplyRightRoles.Protocol memory p = _protocol();
        SupplyRightRoles.Wallets memory w = _roleWallets();
        string memory asRole = vm.envOr("SETUP_ROLES_AS", string("deployer"));
        require(_eq(asRole, "deployer") || _eq(asRole, "admin"), "SETUP_ROLES_AS must be deployer | admin");
        Role callerRole = _eq(asRole, "admin") ? Role.Admin : Role.Deployer;
        address caller = _wallet(callerRole);
        bool renounce = vm.envOr("RENOUNCE_DEPLOYER_ADMIN", false);

        console2.log("Role setup on chain", block.chainid, "as", caller);
        console2.log("  admin    ", w.admin);
        console2.log("  buyer    ", w.buyer);
        console2.log("  provider ", w.provider);
        console2.log("  verifier ", w.verifier);
        address[5] memory contracts =
            [address(p.rights), address(p.protection), address(p.recovery), address(p.vault), address(p.claims)];
        for (uint256 i = 0; i < 5; i++) {
            require(
                IAccessControl(contracts[i]).hasRole(SupplyRightRoles.DEFAULT_ADMIN_ROLE, caller),
                "caller lacks DEFAULT_ADMIN_ROLE; run as the deployer or the admin wallet"
            );
        }

        _startBroadcastAs(callerRole);
        uint256 sent = SupplyRightRoles.grant(p, w);
        vm.stopBroadcast();
        console2.log("  role grants sent:", sent);
        _requireRoleMatrix(p, w);

        if (renounce && callerRole == Role.Deployer && caller != w.admin) {
            _startBroadcastAs(Role.Deployer);
            for (uint256 i = 0; i < 5; i++) {
                IAccessControl(contracts[i]).renounceRole(SupplyRightRoles.DEFAULT_ADMIN_ROLE, caller);
            }
            vm.stopBroadcast();
            console2.log("  deployer renounced DEFAULT_ADMIN_ROLE; admin wallet is the sole admin");
        }
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
