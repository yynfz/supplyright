// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightRoles} from "./lib/SupplyRightRoles.sol";
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

/// @notice Deploys and wires (one-time bindings) the SupplyRight protocol, settled in native ETH, then assigns
///         the four-wallet role matrix (see SupplyRightRoles) and verifies it onchain.
///
/// Sepolia:
///   forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast --slow \
///     --account supplyright-sepolia-deployer.json --sender <deployer address>
///   Role addresses come from config/wallets.sepolia.json; the deployed addresses are written to
///   deployments/11155111.json and back into that config file.
///
/// Local Anvil: no flags needed. The deployer (#0) additionally keeps REGISTRAR/TRANSFER_APPROVER so the
/// local demo personas keep working.
///
/// Env: SETTLEMENT_DELAY (seconds between approval and settlement, default 0)
///      APPEAL_WINDOW    (seconds a rejection stays appealable, default 3 days)
contract Deploy is ScriptBase {
    function run() external returns (SupplyRightRoles.Protocol memory p) {
        address deployer = _wallet(Role.Deployer);
        SupplyRightRoles.Wallets memory w = _roleWallets();
        uint256 startBlock = block.number;
        uint64 settlementDelay = uint64(vm.envOr("SETTLEMENT_DELAY", uint256(0)));
        uint64 appealWindow = uint64(vm.envOr("APPEAL_WINDOW", uint256(3 days)));

        _startBroadcastAs(Role.Deployer);

        p.rights = new SupplyRightNFT(deployer);
        p.protection = new ProtectionNFT(deployer);
        p.recovery = new RecoveryClaimNFT(deployer);
        p.vault = new SupplyProtectionVault(
            deployer, ISupplyRightNFT(address(p.rights)), IProtectionNFT(address(p.protection))
        );
        p.claims = new SupplyClaimManager(
            deployer,
            ISupplyRightNFT(address(p.rights)),
            ISupplyProtectionVault(address(p.vault)),
            IRecoveryClaimNFT(address(p.recovery)),
            settlementDelay,
            appealWindow
        );

        // One-time wiring. After this the admin cannot re-point mint/payout authority.
        p.protection.bindVault(address(p.vault));
        p.recovery.bindClaimManager(address(p.claims));
        p.rights.bindProtocol(address(p.vault), address(p.claims));
        p.vault.bindClaimManager(address(p.claims));

        if (_isLocal()) {
            p.rights.grantRole(p.rights.REGISTRAR_ROLE(), deployer);
            p.rights.grantRole(p.rights.TRANSFER_APPROVER_ROLE(), deployer);
            p.recovery.grantRole(p.recovery.TRANSFER_APPROVER_ROLE(), deployer);
        }
        uint256 grants = SupplyRightRoles.grant(p, w);

        vm.stopBroadcast();

        console2.log("SupplyRight deployed on chain", block.chainid);
        console2.log("  settlement      native ETH");
        console2.log("  supplyRightNFT  ", address(p.rights));
        console2.log("  protectionNFT   ", address(p.protection));
        console2.log("  recoveryClaimNFT", address(p.recovery));
        console2.log("  vault           ", address(p.vault));
        console2.log("  claimManager    ", address(p.claims));
        console2.log("  role grants sent", grants);
        _requireRoleMatrix(p, w);
        if (_broadcasting()) _write(p, deployer, startBlock);
        else console2.log("Dry run: deployment files not written (add --broadcast to deploy).");
    }

    function _write(SupplyRightRoles.Protocol memory p, address deployer, uint256 startBlock) private {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeUint(k, "deployedAt", block.timestamp);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeString(k, "settlementAsset", "native");
        vm.serializeAddress(k, "supplyRightNFT", address(p.rights));
        vm.serializeAddress(k, "protectionNFT", address(p.protection));
        vm.serializeAddress(k, "recoveryClaimNFT", address(p.recovery));
        vm.serializeAddress(k, "vault", address(p.vault));
        string memory json = vm.serializeAddress(k, "claimManager", address(p.claims));
        vm.writeJson(json, _deploymentPath());

        if (block.chainid == SEPOLIA_CHAIN_ID) {
            string memory c = "contracts";
            vm.serializeAddress(c, "supplyRightNFT", address(p.rights));
            vm.serializeAddress(c, "protectionNFT", address(p.protection));
            vm.serializeAddress(c, "recoveryClaimNFT", address(p.recovery));
            vm.serializeAddress(c, "vault", address(p.vault));
            string memory contracts = vm.serializeAddress(c, "claimManager", address(p.claims));
            vm.writeJson(contracts, _walletConfigPath(), ".contracts");
        }
    }
}
