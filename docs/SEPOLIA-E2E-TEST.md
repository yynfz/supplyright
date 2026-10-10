# Sepolia End-to-End Test Workflow

This document details the test flow, multi-signer roles, resumption mechanisms, and duplicate prevention for SupplyRight on **Ethereum Sepolia**.

## 1. Multi-Signer Roles & On-Chain Authority

The test flow utilizes four independent signers plus the deployer:

1. **Deployer** (`0x959a7CDa30042C26deAAE4Cf27Cc319dFE2CB5B8`):
   - Holds initial `DEFAULT_ADMIN_ROLE`.
   - Runs `script/SetupRoles.s.sol` to grant roles to the 4 role wallets.
2. **Admin & Registrar** (`0x3a570002A98Bbe4cC7A182ccdbb5EF0dc2633CBc`):
   - Holds `REGISTRAR_ROLE`, `TRANSFER_APPROVER_ROLE`, `DEFAULT_ADMIN_ROLE`.
   - Mints and activates `SupplyRightNFT`.
3. **Buyer** (`0x6ACF72e4047d26b1C0AA6292BD38B03E9a70580B`):
   - Holds `BUYER_ROLE`.
   - Requests protection on the SupplyRight NFT, submits default claim upon supplier failure.
4. **Provider** (`0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066`):
   - Holds `PROVIDER_ROLE`.
   - Deposits collateral into `SupplyProtectionVault` escrow and approves protection.
   - Receives `RecoveryClaimNFT` upon atomic settlement.
5. **Verifier** (`0x4481A845dFb7855dC1e0946C26965f4a856B12dD`):
   - Holds `VERIFIER_ROLE`.
   - Independently reviews evidence and approves verified loss and payout.

---

## 2. Test Execution Architecture

### Local Multi-Signer Integration Tests
Executed with Foundry Forge:
```bash
forge test --match-contract MultiSignerRolesTest -vvv
```
Verifies:
- Full E2E flow across 4 separate signers.
- Negative tests: unauthorized role access, unauthorized minting, unauthorized approval.
- Security tests: double claim prevention, insufficient escrow, invalid NFT transfer, double settlement prevention, atomic rollback on payment failure.

### Resumable Sepolia Runner
The script `script/RunSepoliaE2E.s.sol` performs real on-chain actions in sequence:
- **Resumable State**: Records progress in `contracts/deployments/sepolia-e2e-state.json`. If an RPC disconnects or a transaction needs confirmation, the script picks up at the current step.
- **Duplicate Prevention**: Before settlement, verifies that the claim status is not already `Settled`.
- **Role Keystores**: Each step signs using the role-specific keystore or private key.

Execution command:
```bash
forge script script/RunSepoliaE2E.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast
```

---

## 3. Protocol Economics & Expected Settlement

For a case study with:
- Contract Value: `0.050 ETH`
- Ordered: `50 MT`, Delivered: `10 MT` (Shortfall: `40 MT`, Loss: `0.040 ETH`)
- Escrow Collateral: Exactly `0.010 Sepolia ETH` deposited by Provider
- Coverage BPS: `2000` (20%)

**Settlement Outcome:**
1. **Buyer Payout**: `20% * 0.040 ETH = 0.008 ETH` transferred to Buyer.
2. **Remaining Escrow**: `0.002 ETH` remains safely locked in the vault until expiry/release.
3. **Recovery Claim NFT**: Minted directly to Provider (`0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066`).
4. **SupplyRight NFT Status**: Transitions atomically to `Defaulted`.

---

## 4. Live Testing Status & Safeguards

- **Local Multi-Signer Tests**: `PASS` (10 of 10 tests passed).
- **Full Forge Test Suite**: `PASS` (68 of 68 tests passed).
- **Live Sepolia Transactions**: `BLOCKED` until deployer and role wallets receive native Sepolia ETH and explicit user approval is granted.

