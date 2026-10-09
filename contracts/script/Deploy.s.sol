// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {MockETH} from "../src/MockETH.sol";
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

/// @notice Deploys, wires (one-time bindings) and configures roles for the SupplyRight protocol.
///
/// Environment (Sepolia; on the local Anvil chain everything has defaults):
///   DEPLOYER_PRIVATE_KEY   admin + registrar + transfer approver
///   BUYER_ADDRESSES        comma-separated buyers to onboard (BUYER_ROLE)
///   PROVIDER_ADDRESSES     comma-separated protection providers (PROVIDER_ROLE)
///   VERIFIER_ADDRESSES     comma-separated independent verifiers (VERIFIER_ROLE)
///   REGISTRAR_ADDRESSES    optional extra registrars
///   SETTLEMENT_TOKEN       optional existing ERC-20 (e.g. WETH); default deploys MockETH
///   SETTLEMENT_DELAY       seconds between approval and settlement (default 0)
///   APPEAL_WINDOW          seconds a rejection stays appealable (default 3 days)
contract Deploy is ScriptBase {
    struct Deployed {
        address settlementToken;
        bool mockToken;
        SupplyRightNFT rights;
        ProtectionNFT protection;
        RecoveryClaimNFT recovery;
        SupplyProtectionVault vault;
        SupplyClaimManager claims;
    }

    function run() external returns (Deployed memory d) {
        uint256 deployerKey = _key("DEPLOYER_PRIVATE_KEY", ANVIL_KEY_0);
        address deployer = vm.addr(deployerKey);
        uint256 startBlock = block.number;

        address[] memory buyers = _addresses("BUYER_ADDRESSES", vm.addr(ANVIL_KEY_1));
        address[] memory providers = _addresses("PROVIDER_ADDRESSES", vm.addr(ANVIL_KEY_2));
        address[] memory verifiers = _addresses("VERIFIER_ADDRESSES", vm.addr(ANVIL_KEY_3));
        address[] memory registrars = _optionalAddresses("REGISTRAR_ADDRESSES");
        uint64 settlementDelay = uint64(vm.envOr("SETTLEMENT_DELAY", uint256(0)));
        uint64 appealWindow = uint64(vm.envOr("APPEAL_WINDOW", uint256(3 days)));
        address existingToken = vm.envOr("SETTLEMENT_TOKEN", address(0));

        vm.startBroadcast(deployerKey);

        if (existingToken == address(0)) {
            d.settlementToken = address(new MockETH());
            d.mockToken = true;
        } else {
            d.settlementToken = existingToken;
        }
        d.rights = new SupplyRightNFT(deployer);
        d.protection = new ProtectionNFT(deployer);
        d.recovery = new RecoveryClaimNFT(deployer);
        d.vault = new SupplyProtectionVault(
            deployer, IERC20(d.settlementToken), ISupplyRightNFT(address(d.rights)), IProtectionNFT(address(d.protection))
        );
        d.claims = new SupplyClaimManager(
            deployer,
            ISupplyRightNFT(address(d.rights)),
            ISupplyProtectionVault(address(d.vault)),
            IRecoveryClaimNFT(address(d.recovery)),
            settlementDelay,
            appealWindow
        );

        // One-time wiring. After this the admin cannot re-point mint/payout authority.
        d.protection.bindVault(address(d.vault));
        d.recovery.bindClaimManager(address(d.claims));
        d.rights.bindProtocol(address(d.vault), address(d.claims));
        d.vault.bindClaimManager(address(d.claims));

        // Roles
        d.rights.grantRole(d.rights.REGISTRAR_ROLE(), deployer);
        d.rights.grantRole(d.rights.TRANSFER_APPROVER_ROLE(), deployer);
        d.recovery.grantRole(d.recovery.TRANSFER_APPROVER_ROLE(), deployer);
        for (uint256 i = 0; i < registrars.length; i++) {
            d.rights.grantRole(d.rights.REGISTRAR_ROLE(), registrars[i]);
        }
        for (uint256 i = 0; i < buyers.length; i++) {
            d.rights.grantRole(d.rights.BUYER_ROLE(), buyers[i]);
        }
        for (uint256 i = 0; i < providers.length; i++) {
            d.vault.grantRole(d.vault.PROVIDER_ROLE(), providers[i]);
        }
        for (uint256 i = 0; i < verifiers.length; i++) {
            d.claims.grantRole(d.claims.VERIFIER_ROLE(), verifiers[i]);
        }

        vm.stopBroadcast();

        _write(d, deployer, startBlock);
        console2.log("SupplyRight deployed on chain", block.chainid);
        console2.log("  settlementToken ", d.settlementToken);
        console2.log("  supplyRightNFT  ", address(d.rights));
        console2.log("  protectionNFT   ", address(d.protection));
        console2.log("  recoveryClaimNFT", address(d.recovery));
        console2.log("  vault           ", address(d.vault));
        console2.log("  claimManager    ", address(d.claims));
    }

    function _write(Deployed memory d, address deployer, uint256 startBlock) private {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeUint(k, "deployedAt", block.timestamp);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeBool(k, "mockToken", d.mockToken);
        vm.serializeAddress(k, "settlementToken", d.settlementToken);
        vm.serializeAddress(k, "supplyRightNFT", address(d.rights));
        vm.serializeAddress(k, "protectionNFT", address(d.protection));
        vm.serializeAddress(k, "recoveryClaimNFT", address(d.recovery));
        vm.serializeAddress(k, "vault", address(d.vault));
        string memory json = vm.serializeAddress(k, "claimManager", address(d.claims));
        vm.writeJson(json, _deploymentPath());
    }

    function _addresses(string memory envName, address localDefault) private view returns (address[] memory) {
        if (_isLocal()) {
            address[] memory fallback_ = new address[](1);
            fallback_[0] = localDefault;
            return vm.envOr(envName, ",", fallback_);
        }
        return vm.envAddress(envName, ",");
    }

    function _optionalAddresses(string memory envName) private view returns (address[] memory) {
        return vm.envOr(envName, ",", new address[](0));
    }
}
