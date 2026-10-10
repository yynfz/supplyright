// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {SupplyRightRoles} from "./lib/SupplyRightRoles.sol";

/// @notice Shared helpers: role wallet resolution, per-role broadcasting and deployment-file IO.
///
///         Sepolia (11155111): role addresses come from config/wallets.sepolia.json and every transaction is
///         signed by that role's encrypted Foundry keystore, loaded with `--account <alias>` (forge selects
///         the signer by address in `vm.startBroadcast(address)`). No private key is read from the env.
///
///         Local Anvil (31337): Anvil's publicly known development keys, never valid on a public network.
///           deployer #0 · buyer #1 · provider #2 · verifier #3 · admin #4
abstract contract ScriptBase is Script {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    // Publicly known Anvil/Hardhat development keys (accounts #0-#4). Local chain only.
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL_KEY_1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant ANVIL_KEY_2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant ANVIL_KEY_3 = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 internal constant ANVIL_KEY_4 = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    enum Role {
        Deployer,
        Admin,
        Buyer,
        Provider,
        Verifier
    }

    function _isLocal() internal view returns (bool) {
        return block.chainid == ANVIL_CHAIN_ID;
    }

    /// @dev True when transactions are actually sent (`--broadcast` / `--resume`), false on a dry run. Files that
    ///      record onchain facts are only written when broadcasting.
    function _broadcasting() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    // ---------------------------------------------------------------------
    // Role wallets
    // ---------------------------------------------------------------------

    function _wallet(Role r) internal view returns (address) {
        if (_isLocal()) return vm.addr(_localKey(r));
        require(block.chainid == SEPOLIA_CHAIN_ID, "SupplyRight scripts support Anvil 31337 and Sepolia 11155111");
        string memory json = vm.readFile(_walletConfigPath());
        string memory path = r == Role.Deployer ? ".deployer.address" : string.concat(".wallets.", _roleKey(r), ".address");
        // Reverts if the address is still null, i.e. the wallets were not created yet.
        return vm.parseJsonAddress(json, path);
    }

    function _roleWallets() internal view returns (SupplyRightRoles.Wallets memory w) {
        w = SupplyRightRoles.Wallets({
            admin: _wallet(Role.Admin),
            buyer: _wallet(Role.Buyer),
            provider: _wallet(Role.Provider),
            verifier: _wallet(Role.Verifier)
        });
        SupplyRightRoles.validate(w);
        require(
            !_isRoleWallet(w, _wallet(Role.Deployer)) || _isLocal(),
            "deployer must not double as a role wallet on Sepolia"
        );
    }

    /// @dev Local: sign with the Anvil key. Sepolia: sign with the keystore loaded via `--account`.
    function _startBroadcastAs(Role r) internal {
        if (_isLocal()) vm.startBroadcast(_localKey(r));
        else vm.startBroadcast(_wallet(r));
    }

    function _roleKey(Role r) internal pure returns (string memory) {
        if (r == Role.Admin) return "admin";
        if (r == Role.Buyer) return "buyer";
        if (r == Role.Provider) return "provider";
        if (r == Role.Verifier) return "verifier";
        return "deployer";
    }

    function _localKey(Role r) private pure returns (uint256) {
        if (r == Role.Deployer) return ANVIL_KEY_0;
        if (r == Role.Buyer) return ANVIL_KEY_1;
        if (r == Role.Provider) return ANVIL_KEY_2;
        if (r == Role.Verifier) return ANVIL_KEY_3;
        return ANVIL_KEY_4;
    }

    function _isRoleWallet(SupplyRightRoles.Wallets memory w, address a) private pure returns (bool) {
        return a == w.admin || a == w.buyer || a == w.provider || a == w.verifier;
    }

    // ---------------------------------------------------------------------
    // Deployment files
    // ---------------------------------------------------------------------

    function _walletConfigPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../config/wallets.sepolia.json");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }

    function _demoPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), "-demo.json");
    }

    function _readDeployment(string memory field) internal view returns (address) {
        string memory json = vm.readFile(_deploymentPath());
        return vm.parseJsonAddress(json, string.concat(".", field));
    }

    function _protocol() internal view returns (SupplyRightRoles.Protocol memory p) {
        p = SupplyRightRoles.Protocol({
            rights: SupplyRightNFT(_readDeployment("supplyRightNFT")),
            protection: ProtectionNFT(_readDeployment("protectionNFT")),
            recovery: RecoveryClaimNFT(_readDeployment("recoveryClaimNFT")),
            vault: SupplyProtectionVault(_readDeployment("vault")),
            claims: SupplyClaimManager(_readDeployment("claimManager"))
        });
    }

    /// @dev Logs the live role state and reverts if it deviates from the four-wallet matrix.
    function _requireRoleMatrix(SupplyRightRoles.Protocol memory p, SupplyRightRoles.Wallets memory w) internal view {
        string[] memory issues = SupplyRightRoles.problems(p, w);
        for (uint256 i = 0; i < issues.length; i++) {
            console2.log("  role check FAILED:", issues[i]);
        }
        require(issues.length == 0, "role matrix does not hold onchain");
        console2.log("  role matrix verified onchain: admin / buyer / provider / verifier separated");
    }

    /// @dev SHA-256 of a demo document, so anyone holding the file can verify it with `sha256sum`.
    function _docHash(string memory fileName) internal view returns (bytes32) {
        string memory path = string.concat(vm.projectRoot(), "/../demo/documents/", fileName);
        return sha256(vm.readFileBinary(path));
    }

    function _log(string memory step, string memory detail) internal pure {
        console2.log(string.concat("[SupplyRight] ", step, " - ", detail));
    }
}
