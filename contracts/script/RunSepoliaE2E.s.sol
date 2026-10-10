// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {ScriptBase} from "./ScriptBase.s.sol";
import {SupplyRightNFT} from "../src/SupplyRightNFT.sol";
import {SupplyProtectionVault} from "../src/SupplyProtectionVault.sol";
import {SupplyClaimManager} from "../src/SupplyClaimManager.sol";
import {RecoveryClaimNFT} from "../src/RecoveryClaimNFT.sol";
import {ProtectionNFT} from "../src/ProtectionNFT.sol";
import {MockETH} from "../src/MockETH.sol";
import {DefaultType, ClaimRecord, ClaimStatus, ProtectionPosition} from "../src/SupplyTypes.sol";

/// @notice Resumable, state-tracking Sepolia End-to-End runner for SupplyRight.
///         Executes each step signed by the corresponding encrypted role wallet.
///         Tracks state to prevent duplicate settlement and enable resumption after failure.
contract RunSepoliaE2E is ScriptBase {
    uint256 internal constant MT = 1e3;
    uint256 internal constant ORDERED = 50 * MT;
    uint256 internal constant DELIVERED = 10 * MT;
    uint256 internal constant CONTRACT_VAL = 0.05 ether;
    uint256 internal constant ESCROW_COVERAGE = 0.010 ether; // Exactly 0.010 ETH in escrow
    uint16 internal constant COVERAGE_BPS = 2_000;          // 20%
    uint256 internal constant SHORTFALL_LOSS = 0.040 ether;
    uint256 internal constant EXPECTED_PAYOUT = 0.008 ether;

    function run() external {
        string memory statePath = string.concat(vm.projectRoot(), "/deployments/sepolia-e2e-state.json");
        console2.log("=== SupplyRight Sepolia E2E Execution Runner ===");
        console2.log("State file:", statePath);

        // Resolve signers (either env keys or test defaults if local)
        uint256 adminKey = _key("ADMIN_PRIVATE_KEY", ANVIL_KEY_0);
        uint256 buyerKey = _key("BUYER_PRIVATE_KEY", ANVIL_KEY_1);
        uint256 providerKey = _key("PROVIDER_PRIVATE_KEY", ANVIL_KEY_2);
        uint256 verifierKey = _key("VERIFIER_PRIVATE_KEY", ANVIL_KEY_3);

        address adminAddr = vm.addr(adminKey);
        address buyerAddr = vm.addr(buyerKey);
        address providerAddr = vm.addr(providerKey);
        address verifierAddr = vm.addr(verifierKey);

        console2.log("Signers:");
        console2.log("  Admin    :", adminAddr);
        console2.log("  Buyer    :", buyerAddr);
        console2.log("  Provider :", providerAddr);
        console2.log("  Verifier :", verifierAddr);

        SupplyRightNFT rights = SupplyRightNFT(_readDeployment("supplyRightNFT"));
        SupplyProtectionVault vault = SupplyProtectionVault(_readDeployment("vault"));
        SupplyClaimManager claims = SupplyClaimManager(_readDeployment("claimManager"));
        RecoveryClaimNFT recovery = RecoveryClaimNFT(_readDeployment("recoveryClaimNFT"));
        ProtectionNFT protection = ProtectionNFT(_readDeployment("protectionNFT"));
        MockETH token = MockETH(_readDeployment("settlementToken"));

        // Read or initialize state
        uint256 currentStep = 0;
        uint256 tokenId = 0;
        uint256 reqId = 0;
        uint256 protectionId = 0;
        uint256 claimId = 0;
        uint256 recoveryTokenId = 0;

        if (vm.exists(statePath)) {
            string memory stateJson = vm.readFile(statePath);
            currentStep = vm.parseJsonUint(stateJson, ".step");
            tokenId = vm.parseJsonUint(stateJson, ".tokenId");
            reqId = vm.parseJsonUint(stateJson, ".reqId");
            protectionId = vm.parseJsonUint(stateJson, ".protectionId");
            claimId = vm.parseJsonUint(stateJson, ".claimId");
            recoveryTokenId = vm.parseJsonUint(stateJson, ".recoveryTokenId");
            console2.log("Resuming from existing state. Last completed step:", currentStep);
        } else {
            console2.log("Starting fresh E2E flow from step 1.");
        }

        // ---------------------------------------------------------------------
        // Step 1: Admin validates PO and mints SupplyRight NFT
        // ---------------------------------------------------------------------
        if (currentStep < 1) {
            console2.log("\n[Step 1] Admin mints and activates SupplyRight NFT for Buyer...");
            uint64 deadline = uint64(block.timestamp + 180); // 3 minutes or coarse timestamp

            vm.startBroadcast(adminKey);
            bytes32 poRef = keccak256(abi.encodePacked("PO-SEPOLIA-", block.timestamp));
            tokenId = rights.mintSupplyRight(
                SupplyRightNFT.MintParams({
                    buyer: buyerAddr,
                    poRefHash: poRef,
                    agreementHash: keccak256("AGREEMENT-SEPOLIA-001"),
                    supplierRefHash: keccak256("SUPPLIER-SEPOLIA-001"),
                    contractValue: CONTRACT_VAL,
                    orderedQuantity: ORDERED,
                    deliveryDeadline: deadline,
                    unit: bytes8("MT")
                })
            );
            rights.activate(tokenId, keccak256("ACK-SEPOLIA-001"));
            rights.recordDelivery(tokenId, DELIVERED, keccak256("DN-SEPOLIA-001"));
            vm.stopBroadcast();

            currentStep = 1;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
            console2.log("Step 1 complete. Token ID:", tokenId);
        }

        // ---------------------------------------------------------------------
        // Step 2: Buyer requests protection
        // ---------------------------------------------------------------------
        if (currentStep < 2) {
            console2.log("\n[Step 2] Buyer requests protection for Token ID:", tokenId);
            vm.startBroadcast(buyerKey);
            reqId = vault.requestProtection(
                tokenId,
                providerAddr,
                ESCROW_COVERAGE,
                COVERAGE_BPS,
                uint64(block.timestamp + 30 days),
                keccak256("TERMS-SEPOLIA-001")
            );
            vm.stopBroadcast();

            currentStep = 2;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
            console2.log("Step 2 complete. Request ID:", reqId);
        }

        // ---------------------------------------------------------------------
        // Step 3: Provider deposits 0.010 ETH into escrow and approves protection
        // ---------------------------------------------------------------------
        if (currentStep < 3) {
            console2.log("\n[Step 3] Provider deposits 0.010 ETH into escrow...");
            vm.startBroadcast(providerKey);
            if (token.balanceOf(providerAddr) < ESCROW_COVERAGE) {
                token.faucet(ESCROW_COVERAGE);
            }
            token.approve(address(vault), ESCROW_COVERAGE);
            vault.deposit(ESCROW_COVERAGE);
            protectionId = vault.approveProtection(reqId, keccak256("MEMO-SEPOLIA-001"));
            vm.stopBroadcast();

            currentStep = 3;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
            console2.log("Step 3 complete. Protection ID:", protectionId);
        }

        // ---------------------------------------------------------------------
        // Step 4: Buyer submits claim after deadline
        // ---------------------------------------------------------------------
        if (currentStep < 4) {
            console2.log("\n[Step 4] Checking delivery deadline before claim submission...");
            uint64 deadline = rights.getSupplyRight(tokenId).deliveryDeadline;
            if (block.timestamp <= deadline) {
                console2.log("Delivery deadline not yet passed. Please wait until:", deadline);
                return;
            }

            console2.log("Buyer submits claim for Protection ID:", protectionId);
            vm.startBroadcast(buyerKey);
            claimId = claims.submitClaim(
                protectionId,
                DefaultType.Partial,
                SHORTFALL_LOSS,
                DELIVERED,
                keccak256("EVIDENCE-CLAIM-001")
            );
            vm.stopBroadcast();

            currentStep = 4;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
            console2.log("Step 4 complete. Claim ID:", claimId);
        }

        // ---------------------------------------------------------------------
        // Step 5: Verifier approves claim
        // ---------------------------------------------------------------------
        if (currentStep < 5) {
            console2.log("\n[Step 5] Verifier approves Claim ID:", claimId);
            vm.startBroadcast(verifierKey);
            claims.approveClaim(claimId, DELIVERED, SHORTFALL_LOSS, keccak256("DECISION-CLAIM-001"));
            vm.stopBroadcast();

            currentStep = 5;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
            console2.log("Step 5 complete. Claim approved.");
        }

        // ---------------------------------------------------------------------
        // Step 6: Atomic settlement (Duplicate Prevention Guarded)
        // ---------------------------------------------------------------------
        if (currentStep < 6) {
            console2.log("\n[Step 6] Executing atomic settlement for Claim ID:", claimId);
            ClaimRecord memory c = claims.getClaim(claimId);
            if (c.status == ClaimStatus.Settled) {
                console2.log("Claim is already settled. Skipping duplicate transaction.");
            } else {
                vm.startBroadcast(buyerKey);
                recoveryTokenId = claims.settleClaim(claimId);
                vm.stopBroadcast();
                console2.log("Settlement complete. Recovery Claim NFT ID:", recoveryTokenId);
            }

            currentStep = 6;
            _saveState(statePath, currentStep, tokenId, reqId, protectionId, claimId, recoveryTokenId);
        }

        // ---------------------------------------------------------------------
        // Step 7: Post-settlement verification
        // ---------------------------------------------------------------------
        console2.log("\n[Step 7] Verifying final protocol states...");
        ProtectionPosition memory p = vault.getProtection(protectionId);
        console2.log("  Remaining locked escrow in vault:", p.lockedAmount);
        console2.log("  Buyer balance:", token.balanceOf(buyerAddr));
        console2.log("  Recovery NFT owner:", recovery.ownerOf(recoveryTokenId));
        require(recovery.ownerOf(recoveryTokenId) == providerAddr, "Provider must own Recovery NFT");
        require(p.lockedAmount == 0.002 ether, "0.002 ETH must remain in vault");

        console2.log("\n=== Sepolia E2E Flow Successfully Completed! ===");
    }

    function _saveState(
        string memory path,
        uint256 step,
        uint256 tokenId,
        uint256 reqId,
        uint256 protectionId,
        uint256 claimId,
        uint256 recoveryTokenId
    ) internal {
        string memory s = "state";
        vm.serializeUint(s, "step", step);
        vm.serializeUint(s, "tokenId", tokenId);
        vm.serializeUint(s, "reqId", reqId);
        vm.serializeUint(s, "protectionId", protectionId);
        vm.serializeUint(s, "claimId", claimId);
        string memory json = vm.serializeUint(s, "recoveryTokenId", recoveryTokenId);
        vm.writeJson(json, path);
    }
}

