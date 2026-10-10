# Sepolia Wallets Setup & Security Guide

This document describes the secure four-wallet architecture for SupplyRight on **Ethereum Sepolia** (Chain ID: `11155111`).

## 1. Role Architecture & Public Addresses

| Role | Alias | Public Address | On-Chain Responsibility |
| :--- | :--- | :--- | :--- |
| **Deployer & Default Admin** | `deployer` | `0x959a7CDa30042C26deAAE4Cf27Cc319dFE2CB5B8` | Initial contract deployer and protocol administrator. |
| **Admin & Registrar** | `supplyright-admin` | `0x3a570002A98Bbe4cC7A182ccdbb5EF0dc2633CBc` | Validates off-chain PO documents, mints SupplyRight NFTs, assigns roles. |
| **Buyer** | `supplyright-buyer` | `0x6ACF72e4047d26b1C0AA6292BD38B03E9a70580B` | Registers POs, owns SupplyRight NFTs, files default claims, receives payouts. |
| **Protection Provider** | `supplyright-provider` | `0xDAB3737215e8BA6b4d18e47b422a52bCfE03e066` | Underwrites protection, deposits 0.010 Sepolia ETH collateral in escrow, receives Recovery Claim NFTs. |
| **Independent Verifier** | `supplyright-verifier` | `0x4481A845dFb7855dC1e0946C26965f4a856B12dD` | Independently assesses delivery shortfall, approves or rejects claims. |

*Suppliers remain off-chain and do not need Ethereum wallets.*

---

## 2. Keystore Storage & Security

- **Location**: Keystores are stored securely in standard JSON keystore directories:
  - Linux/WSL: `~/.foundry/keystores/`
  - Windows: `%USERPROFILE%\.foundry\keystores\`
- **Files**:
  - `~/.foundry/keystores/supplyright-buyer`
  - `~/.foundry/keystores/supplyright-provider`
  - `~/.foundry/keystores/supplyright-verifier`
  - `~/.foundry/keystores/supplyright-admin`
- **Security Principles**:
  - Private keys and mnemonics are never written or logged to source code.
  - Keystore passwords must not be hardcoded or checked into version control.
  - Each role uses an independent, unique EOA private key.
  - Keystore JSON files are git-ignored and remain strictly on the local machine.

---

## 3. Configuration & Metadata

Public wallet addresses and network configuration are tracked in:
`config/wallets.sepolia.json`

Environment variables needed:
- `SEPOLIA_RPC_URL`: The Ethereum Sepolia RPC endpoint URL (e.g., `https://ethereum-sepolia-rpc.publicnode.com` or Alchemy/Infura URL).
- `ETHERSCAN_API_KEY`: (Optional) For contract verification.

---

## 4. Wallet Creation Script

The setup script `scripts/setup-supplyright-wallets.sh` automates keystore generation using Foundry `cast`:

```bash
chmod +x scripts/setup-supplyright-wallets.sh
./scripts/setup-supplyright-wallets.sh
```

It checks whether each keystore exists before creating it, preserving all existing keystore files.

---

## 5. Funding Verification & Preparation

Run the funding preparation tool before executing on-chain transactions:

```bash
node scripts/prepare-funding.mjs
```

This tool:
1. Inspects the balances of the deployer and the four role wallets.
2. Calculates gas requirements and the 0.010 ETH escrow requirement for the provider.
3. Outlines proposed funding transactions.
4. Enforces a safety stop requiring explicit user confirmation before any live transfer is broadcast.

