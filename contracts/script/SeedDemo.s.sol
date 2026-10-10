// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";

/// @notice Demo phase 1 - FICTIONAL case study, testnet values only.
///         Registers three supply rights for "PT Contoh Manufaktur Baterai (fiktif)":
///           A  Nikel Sulfat 50 MT / 100 ETH  - active, 10 MT delivered, protected (20 ETH @ 20%)
///           B  Litium Karbonat 12 MT / 36 ETH - fulfilled
///           C  Aluminium Ingot 80 MT / 48 ETH - active, unprotected
///         Every hash is the SHA-256 of the matching file in demo/documents. Amounts are native ETH and
///         sized for the local Anvil chain (its dev accounts hold 10,000 test ETH); on Sepolia use
///         RunSepoliaE2E, whose amounts fit a testnet faucet budget.
///
/// Signers: admin (registrar), buyer, provider - Anvil keys locally, keystores via --account on Sepolia.
/// Env: DEMO_DEADLINE_DELAY  seconds until case A's delivery deadline (default 180)
contract SeedDemo is ScriptBase {
    uint256 internal constant MT = 1e3;

    function run() external {
        address buyer = _wallet(Role.Buyer);
        address provider = _wallet(Role.Provider);

        SupplyRightNFT rights = SupplyRightNFT(_readDeployment("supplyRightNFT"));
        SupplyProtectionVault vault = SupplyProtectionVault(_readDeployment("vault"));

        uint64 deadlineA = uint64(block.timestamp + vm.envOr("DEMO_DEADLINE_DELAY", uint256(180)));
        uint256 coverage = 20 ether;

        // --- Registrar: verify documents offchain, mint, record supplier acknowledgement -------------
        _startBroadcastAs(Role.Admin);
        uint256 a = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: _docHash("PO-2026-0417.txt"),
                agreementHash: _docHash("SA-2026-0417.txt"),
                supplierRefHash: _docHash("SUPPLIER-REF-A.txt"),
                contractValue: 100 ether,
                orderedQuantity: 50 * MT,
                deliveryDeadline: deadlineA,
                unit: bytes8("MT")
            })
        );
        rights.activate(a, _docHash("ACK-PO-2026-0417.txt"));
        rights.recordDelivery(a, 10 * MT, _docHash("DN-0417-01.txt"));

        uint256 b = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: _docHash("PO-2026-0388.txt"),
                agreementHash: _docHash("SA-2026-0388.txt"),
                supplierRefHash: _docHash("SUPPLIER-REF-B.txt"),
                contractValue: 36 ether,
                orderedQuantity: 12 * MT,
                deliveryDeadline: uint64(block.timestamp + 10 days),
                unit: bytes8("MT")
            })
        );
        rights.activate(b, _docHash("ACK-PO-2026-0388.txt"));
        rights.markFulfilled(b, _docHash("DN-0388-FINAL.txt"));

        uint256 c = rights.mintSupplyRight(
            SupplyRightNFT.MintParams({
                buyer: buyer,
                poRefHash: _docHash("PO-2026-0452.txt"),
                agreementHash: _docHash("SA-2026-0452.txt"),
                supplierRefHash: _docHash("SUPPLIER-REF-C.txt"),
                contractValue: 48 ether,
                orderedQuantity: 80 * MT,
                deliveryDeadline: uint64(block.timestamp + 45 days),
                unit: bytes8("MT")
            })
        );
        rights.activate(c, _docHash("ACK-PO-2026-0452.txt"));
        vm.stopBroadcast();
        _log("Registrar", "minted supply rights A, B (fulfilled), C");

        // --- Buyer: request protection for the critical material ------------------------------------
        _startBroadcastAs(Role.Buyer);
        uint256 requestId = vault.requestProtection(
            a, provider, coverage, 2_000, deadlineA + 30 days, _docHash("PROTECTION-TERMS-PT-0417.txt")
        );
        vm.stopBroadcast();
        _log("Buyer", "requested 20 ETH protection at 20% for supply right A");

        // --- Provider: deposit collateral, approve -> Protection NFT --------------------------------
        _startBroadcastAs(Role.Provider);
        vault.deposit{value: coverage}();
        uint256 protectionId = vault.approveProtection(requestId, _docHash("UNDERWRITING-MEMO-0417.txt"));
        vm.stopBroadcast();
        _log("Provider", "deposited 20 ETH and minted the Protection NFT");

        string memory k = "demo";
        vm.serializeUint(k, "supplyRightA", a);
        vm.serializeUint(k, "supplyRightB", b);
        vm.serializeUint(k, "supplyRightC", c);
        vm.serializeUint(k, "requestId", requestId);
        vm.serializeUint(k, "protectionId", protectionId);
        string memory json = vm.serializeUint(k, "deadlineA", deadlineA);
        vm.writeJson(json, _demoPath());

        console2.log("Supply right A:", a);
        console2.log("Protection:", protectionId);
        console2.log("Delivery deadline (unix):", deadlineA);
        console2.log("Next: wait until the deadline passes, then run SeedDemoClaim.s.sol");
    }
}
