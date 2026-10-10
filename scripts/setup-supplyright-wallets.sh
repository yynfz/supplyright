#!/usr/bin/env bash
# ==============================================================================
# SupplyRight - create the four Sepolia role wallets as encrypted Foundry keystores.
#
#   supplyright-admin     Registrar / admin
#   supplyright-buyer     Buyer / manufacturer
#   supplyright-provider  Protection provider
#   supplyright-verifier  Independent verifier
#
# - Uses `cast wallet new <dir> <alias>`: cast asks for the keystore password in a hidden prompt.
#   The password is never passed on the command line, stored, or echoed by this script.
# - Never overwrites: an existing keystore with the same alias (or any other file in the
#   keystore directory, e.g. the deployer keystore) is left untouched.
# - Only public addresses are written, to config/wallets.sepolia.json.
#
# Windows: run from Git Bash, or from PowerShell with
#   & 'C:\Program Files\Git\bin\bash.exe' scripts/setup-supplyright-wallets.sh
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/config/wallets.sepolia.json"
KEYSTORE_DIR="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"

CAST="$(command -v cast || true)"
[ -n "$CAST" ] || CAST="$HOME/.foundry/bin/cast"
if ! "$CAST" --version >/dev/null 2>&1; then
  echo "error: Foundry 'cast' not found (install with foundryup)." >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "error: node is required to update $CONFIG" >&2; exit 1; }

# Keystores must live outside the repository so they can never be committed.
case "$(cd "$(dirname "$KEYSTORE_DIR")" 2>/dev/null && pwd)/$(basename "$KEYSTORE_DIR")" in
  "$ROOT"|"$ROOT"/*) echo "error: keystore directory must be outside the repository" >&2; exit 1 ;;
esac
mkdir -p "$KEYSTORE_DIR"

echo "SupplyRight role wallets - Ethereum Sepolia (chain 11155111)"
echo "cast:      $("$CAST" --version | head -n 1)"
echo "keystores: $KEYSTORE_DIR"
echo

# alias:role-key-in-config
WALLETS="supplyright-admin:admin supplyright-buyer:buyer supplyright-provider:provider supplyright-verifier:verifier"

set_address() { # role address
  node -e '
    const fs = require("fs");
    const [file, role, address] = process.argv.slice(1);
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    cfg.wallets[role].address = address;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  ' "$CONFIG" "$1" "$2"
}

for entry in $WALLETS; do
  alias="${entry%%:*}"
  role="${entry##*:}"
  if [ -e "$KEYSTORE_DIR/$alias" ] || [ -e "$KEYSTORE_DIR/$alias.json" ]; then
    echo "[keep]   $alias already exists - not modified."
    echo "         Check its address with: cast wallet address --account $alias"
    continue
  fi
  echo "[create] $alias - choose a strong password at the hidden prompt."
  # The password prompt is written to the terminal directly; stdout only carries the JSON result
  # (address, public key, file path - no private key).
  json="$("$CAST" wallet new "$KEYSTORE_DIR" "$alias" --json)"
  address="$(printf '%s' "$json" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const r = JSON.parse(s);
      if (!r.success || !r.data?.[0]?.address) process.exit(1);
      process.stdout.write(r.data[0].address);
    });')"
  set_address "$role" "$address"
  echo "         address $address"
done

echo
node -e '
  const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const rows = Object.entries(cfg.wallets).map(([role, w]) => [role, w.address, w.keystoreAlias]);
  const addrs = rows.map(r => (r[1] || "").toLowerCase());
  const valid = addrs.every(a => /^0x[0-9a-f]{40}$/.test(a));
  const distinct = new Set([...addrs, cfg.deployer.address.toLowerCase()]).size === addrs.length + 1;
  console.log("Role       Public address                               Keystore alias");
  for (const [role, a, k] of rows) console.log(role.padEnd(10), (a || "-").padEnd(44), k);
  console.log("deployer  ", cfg.deployer.address.padEnd(44), cfg.deployer.keystoreAlias);
  if (!valid || !distinct) { console.error("\nerror: addresses must be valid and distinct"); process.exit(1); }
  console.log("\nAll role addresses are valid and distinct. Public addresses saved in config/wallets.sepolia.json.");
' "$CONFIG"
