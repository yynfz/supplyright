#!/usr/bin/env bash
# ==============================================================================
# SupplyRight - rehearse the full Sepolia run on a LOCAL Anvil fork of Sepolia (no real transactions).
#
# The fork has chain id 11155111 and the live Sepolia state, so scripts/run-sepolia-e2e.sh exercises exactly the
# Sepolia code paths (config/wallets.sepolia.json addresses, address-selected signers, deployment files) with
# impersonated accounts instead of keystores. Each role wallet gets the amount
# scripts/prepare-funding.mjs plans using the FORK RPC's gas quote. This verifies
# that fork-priced budget for the rehearsal, not the amount needed on live Sepolia.
#
# Everything a chain-11155111 broadcast writes (config contracts, contracts/deployments/11155111*,
# contracts/broadcast/*/11155111, contracts/cache/*/11155111) is backed up first and restored afterwards, so the
# rehearsal never leaves artifacts that could be mistaken for real Sepolia transactions.
#   bash scripts/rehearse-sepolia-fork.sh        (FORK_PORT=8547)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${FORK_PORT:-8547}"
UPSTREAM="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
FORK="http://127.0.0.1:$PORT"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT"

die() { echo "error: $*" >&2; exit 1; }
# A rehearsal moves and removes whole 11155111 directories. Resolve both the
# candidate and its allowed parent first, so symlinks cannot redirect either
# operation outside the intended tree (also compare case-insensitively on Windows).
assert_inside() {
  local actual allowed
  actual="$(cd "$1" && pwd -P)" || die "cannot resolve directory: $1"
  allowed="$(cd "$2" && pwd -P)" || die "cannot resolve allowed root: $2"
  case "${actual,,}" in
    "${allowed,,}"/*) ;;
    *) die "refusing directory operation outside $allowed: $actual" ;;
  esac
}

assert_inside "contracts" "$ROOT"
for kind in broadcast cache; do assert_inside "contracts/$kind" "contracts"; done

BACKUP="$(mktemp -d)"
BACKUP_REAL="$(cd "$BACKUP" && pwd -P)"
assert_backup_root() {
  local actual
  actual="$(cd "$BACKUP" && pwd -P)" || die "backup directory disappeared: $BACKUP"
  [ "${actual,,}" = "${BACKUP_REAL,,}" ] && [ "$actual" != / ] \
    || die "refusing to remove a path other than the mktemp backup root: $actual"
}
cp config/wallets.sepolia.json "$BACKUP/"
mkdir -p "$BACKUP/deployments"
for f in contracts/deployments/11155111*; do [ -e "$f" ] && cp "$f" "$BACKUP/deployments/"; done
for kind in broadcast cache; do
  for d in contracts/"$kind"/*/11155111; do
    [ -d "$d" ] || continue
    assert_inside "$d" "contracts/$kind"
    name="$(basename "$(dirname "$d")")"
    mkdir -p "$BACKUP/$kind/$name"
    assert_inside "$BACKUP/$kind/$name" "$BACKUP"
    mv "$d" "$BACKUP/$kind/$name/"
  done
done

assert_backup_root
ANVIL_LOG="$BACKUP/anvil.log"
RUST_LOG=error anvil --fork-url "$UPSTREAM" --port "$PORT" --auto-impersonate --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" 2>/dev/null || true
  cp "$BACKUP/wallets.sepolia.json" config/wallets.sepolia.json
  rm -f contracts/deployments/11155111*
  for f in "$BACKUP"/deployments/*; do [ -e "$f" ] && cp "$f" contracts/deployments/; done
  for kind in broadcast cache; do
    for d in contracts/"$kind"/*/11155111; do
      [ -e "$d" ] || [ -L "$d" ] || continue
      assert_inside "$d" "contracts/$kind"
      rm -rf "$d"
    done
    for d in "$BACKUP/$kind"/*/11155111; do
      [ -d "$d" ] || continue
      assert_inside "$d" "$BACKUP"
      target="contracts/$kind/$(basename "$(dirname "$d")")"
      assert_inside "$target" "contracts/$kind"
      mv "$d" "$target/"
    done
  done
  assert_backup_root
  rm -rf "$BACKUP"
  echo "rehearsal artifacts removed; original Sepolia files restored"
}
trap cleanup EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "$FORK" >/dev/null 2>&1 && break; sleep 0.3; done
if [ "$(cast chain-id --rpc-url "$FORK" 2>/dev/null || true)" != "11155111" ]; then
  echo "fork did not start; recent Anvil output:" >&2
  tail -n 40 "$ANVIL_LOG" >&2 || true
  exit 1
fi

PROFILE=config/gas-profile.sepolia-fork.json
if [ -f "$PROFILE" ]; then
  echo "==> fork-priced funding plan (Anvil gas quote $(cast gas-price --rpc-url "$FORK") wei; not the live Sepolia funding amount)"
  plan="$(SEPOLIA_RPC_URL="$FORK" node scripts/prepare-funding.mjs --json)"
else
  echo "==> no Glamsterdam gas profile yet: funding generously (0.5 ETH each) to measure it"
  plan="$(node -e '
    const c = require("./config/wallets.sepolia.json"); const big = "500000000000000000";
    console.log(JSON.stringify({ deployer: { address: c.deployer.address, deployGasCostWei: big },
      roles: Object.entries(c.wallets).map(([key, w]) => ({ key, address: w.address, topUpWei: big })) }));')"
fi
node -e '
  const p = JSON.parse(process.argv[1]);
  console.log(`deployer ${p.deployer.address} ${p.deployer.deployGasCostWei}`);
  for (const r of p.roles) console.log(`${r.key} ${r.address} ${r.topUpWei}`);
' "$plan" | while read -r role addr wei; do
  cast rpc anvil_setBalance "$addr" "$(cast to-hex "$wei")" --rpc-url "$FORK" >/dev/null
  echo "  $role $addr $(cast from-wei "$wei") ETH"
done

SIGNER_MODE=unlocked ASSUME_YES=1 SEPOLIA_RPC_URL="$FORK" E2E_DEADLINE_DELAY=30 E2E_RUN_ID=FORK-REHEARSAL \
  REPORT_OUT="$BACKUP/fork-rehearsal.md" REPORT_LABEL="LOCAL FORK REHEARSAL - not Sepolia" \
  bash scripts/run-sepolia-e2e.sh all

echo "==> gas used per signer under Sepolia's (Glamsterdam) rules -> $PROFILE"
node - "$PROFILE" <<'NODE'
const fs = require("fs");
const cfg = require("./config/wallets.sepolia.json");
const names = { [cfg.deployer.address.toLowerCase()]: "deployer" };
for (const [k, w] of Object.entries(cfg.wallets)) names[w.address.toLowerCase()] = k;
const totals = { deployer: 0, admin: 0, buyer: 0, provider: 0, verifier: 0 };
for (const script of ["Deploy.s.sol", "SetupRoles.s.sol", "RunSepoliaE2E.s.sol"]) {
  const dir = `contracts/broadcast/${script}/11155111`;
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f))) {
    const run = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
    run.transactions.forEach((t, i) => {
      const gas = Number(BigInt(run.receipts[i].gasUsed));
      const fn = t.transactionType === "CREATE" ? `create ${t.contractName}` : (t.function ?? "").split("(")[0];
      const who = names[t.transaction.from.toLowerCase()];
      totals[who] += gas;
      console.log(`  ${script.padEnd(20)} ${who.padEnd(9)} ${fn.padEnd(32)} ${String(gas).padStart(10)}`);
    });
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(totals, null, 2) + "\n");
console.log(totals);
NODE
echo
cat "$BACKUP/fork-rehearsal.md"
echo
echo "FORK REHEARSAL: PASS"
