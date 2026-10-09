// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Shared helpers: key resolution (with well-known Anvil keys as local defaults) and
///         deployment-file IO. Never use the Anvil keys on a public network.
abstract contract ScriptBase is Script {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    // Publicly known Anvil/Hardhat development keys (accounts #0-#3). Local chain only.
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL_KEY_1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant ANVIL_KEY_2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant ANVIL_KEY_3 = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;

    function _isLocal() internal view returns (bool) {
        return block.chainid == ANVIL_CHAIN_ID;
    }

    /// @dev Reads `envName`; on the local chain falls back to `localDefault`, elsewhere it is required.
    function _key(string memory envName, uint256 localDefault) internal view returns (uint256) {
        if (_isLocal()) return vm.envOr(envName, localDefault);
        return vm.envUint(envName);
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

    /// @dev SHA-256 of a demo document, so anyone holding the file can verify it with `sha256sum`.
    function _docHash(string memory fileName) internal view returns (bytes32) {
        string memory path = string.concat(vm.projectRoot(), "/../demo/documents/", fileName);
        return sha256(vm.readFileBinary(path));
    }

    function _log(string memory step, string memory detail) internal pure {
        console2.log(string.concat("[SupplyRight] ", step, " - ", detail));
    }
}
