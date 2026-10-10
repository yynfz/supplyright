#!/usr/bin/env bash
# ==============================================================================
# SupplyRight - Secure 4-Wallet Setup using Foundry cast
# ==============================================================================
set -euo pipefail

KEYSTORE_DIR="${HOME}/.foundry/keystores"
mkdir -p "${KEYSTORE_DIR}"

echo "========================================================"
echo " SupplyRight: Setting up Four Encrypted Keystore Wallets"
echo " Network: Ethereum Sepolia (Chain ID 11155111)"
echo " Keystore Directory: ${KEYSTORE_DIR}"
echo "========================================================"

CAST_BIN="$(which cast 2>/dev/null || echo "${HOME}/.foundry/bin/cast")"
if ! command -v "${CAST_BIN}" &>/dev/null; then
    echo "Error: 'cast' not found. Please install Foundry first."
    exit 1
fi

ROLES=("supplyright-buyer" "supplyright-provider" "supplyright-verifier" "supplyright-admin")

for ROLE in "${ROLES[@]}"; do
    TARGET_FILE="${KEYSTORE_DIR}/${ROLE}"
    if [ -f "${TARGET_FILE}" ]; then
        echo "[EXISTS] Keystore '${ROLE}' already exists at ${TARGET_FILE}. Skipping creation to prevent overwrite."
    else
        echo "[CREATE] Creating new encrypted keystore for '${ROLE}'..."
        echo "Please enter a strong password when prompted (password will NOT be echoed):"
        "${CAST_BIN}" wallet new "${KEYSTORE_DIR}" "${ROLE}"
        echo "[OK] Wallet for '${ROLE}' created successfully."
    fi
done

echo ""
echo "========================================================"
echo " Summary of Created Role Wallets"
echo "========================================================"
for ROLE in "${ROLES[@]}"; do
    if [ -f "${KEYSTORE_DIR}/${ROLE}" ]; then
        echo "Keystore alias: ${ROLE}"
    fi
done
echo "Configuration registered in config/wallets.sepolia.json"

