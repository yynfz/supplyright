#!/usr/bin/env bash
# ==============================================================================
# SupplyRight - local integration run on a throwaway Anvil node.
#
# Runs the SAME scripts used on Sepolia (Deploy -> SetupRoles -> RunSepoliaE2E -> CheckPermissions) with five
# distinct signers (Anvil dev accounts: deployer #0, buyer #1, provider #2, verifier #3, admin #4), checks the
# final state with cast, exercises resume/no-duplicate behaviour, sends a direct ETH transfer between two role
# wallets, and prints the measured gas per transaction (input for the Sepolia funding plan).
#
# The existing contracts/deployments/31337*.json files are backed up and restored afterwards.
#   bash scripts/anvil-integration.sh            (ANVIL_PORT=8546 by default)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8546}"
RPC="http://127.0.0.1:$PORT"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT/contracts"

BACKUP="$(mktemp -d)"
for f in deployments/31337.json deployments/31337-demo.json; do [ -f "$f" ] && cp "$f" "$BACKUP/"; done

anvil --port "$PORT" --chain-id 31337 --silent &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" 2>/dev/null || true
  rm -f deployments/31337.json deployments/31337-demo.json
  for f in "$BACKUP"/*; do [ -e "$f" ] && cp "$f" deployments/; done
  rm -rf "$BACKUP"
}
trap cleanup EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
BUYER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
PROVIDER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
VERIFIER=0x90F79bf6EB2c4f870365E785982E1f101E93b906
ADMIN=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
BUYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d  # public Anvil dev key #1

step() { printf '\n==> %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
script() { forge script "$@" --rpc-url "$RPC"; }
START=$(date +%s)

step "Deploy (deployer #0) + role matrix"
script script/Deploy.s.sol:Deploy --broadcast --slow | grep -E "deployed|role|vault|claimManager" || true
VAULT=$(node -p "require('./deployments/31337.json').vault")
CLAIMS=$(node -p "require('./deployments/31337.json').claimManager")
RIGHTS=$(node -p "require('./deployments/31337.json').supplyRightNFT")
RECOVERY=$(node -p "require('./deployments/31337.json').recoveryClaimNFT")

step "SetupRoles is idempotent (expects 0 grants)"
out=$(script script/SetupRoles.s.sol:SetupRoles --broadcast --slow)
echo "$out" | grep -E "grants sent|verified" || true
echo "$out" | grep -q "role grants sent: 0" || fail "SetupRoles re-sent grants"

step "E2E phase setup (admin, buyer, provider)"
E2E_PHASE=setup E2E_DEADLINE_DELAY=60 script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --broadcast --slow | grep -E "^\[|#" || true
[ "$(cast balance "$VAULT" --rpc-url "$RPC")" = "10000000000000000" ] || fail "vault escrow is not 0.010 ETH"

step "E2E phase claim before the deadline sends nothing"
nonce_before=$(cast nonce "$BUYER" --rpc-url "$RPC")
E2E_PHASE=claim script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --broadcast --slow | grep -E "deadline" || true
[ "$(cast nonce "$BUYER" --rpc-url "$RPC")" = "$nonce_before" ] || fail "claim sent before the deadline"

step "advance Anvil time past the delivery deadline"
cast rpc evm_increaseTime 61 --rpc-url "$RPC" >/dev/null && cast rpc evm_mine --rpc-url "$RPC" >/dev/null

step "E2E phase claim (buyer, verifier) - claim, verification, atomic settlement"
buyer_before=$(cast balance "$BUYER" --rpc-url "$RPC")
buyer_nonce=$(cast nonce "$BUYER" --rpc-url "$RPC")
E2E_PHASE=claim script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --broadcast --slow | grep -E "^\[|#" || true
claim_tx=$(node -e '
  const r = require("./broadcast/RunSepoliaE2E.s.sol/31337/run-latest.json");
  const t = r.transactions.find(t => t.transaction.from.toLowerCase() === process.argv[1].toLowerCase());
  process.stdout.write(t.hash)' "$BUYER")

step "re-run after settlement: resume must not duplicate anything"
verifier_nonce=$(cast nonce "$VERIFIER" --rpc-url "$RPC")
E2E_PHASE=claim script script/RunSepoliaE2E.s.sol:RunSepoliaE2E --broadcast --slow | grep -E "Economics|NOTE" || true
[ "$(cast nonce "$VERIFIER" --rpc-url "$RPC")" = "$verifier_nonce" ] || fail "settlement was sent twice"

step "verify final state with cast"
raw=$(cast call "$CLAIMS" "getClaim(uint256)" 1 --rpc-url "$RPC") # static struct; word 7 = status
claim_status=$((16#${raw:$((2 + 64 * 7)):64}))
[ "$claim_status" = "5" ] || fail "claim status is $claim_status, expected 5 (Settled)"
[ "$(cast call "$RECOVERY" "ownerOf(uint256)(address)" 1 --rpc-url "$RPC")" = "$PROVIDER" ] || fail "Recovery NFT not owned by provider"
[ "$(cast call "$RIGHTS" "ownerOf(uint256)(address)" 1 --rpc-url "$RPC")" = "$BUYER" ] || fail "SupplyRight NFT not owned by buyer"
[ "$(cast balance "$VAULT" --rpc-url "$RPC")" = "2000000000000000" ] || fail "vault does not hold the remaining 0.002 ETH"
# The buyer sent one transaction (the claim) in that phase; payout = balance delta + its gas cost.
gas_cost=$(cast receipt "$claim_tx" --rpc-url "$RPC" --json | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);
  process.stdout.write((BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice)).toString())})')
buyer_after=$(cast balance "$BUYER" --rpc-url "$RPC")
payout=$(node -p "(BigInt('$buyer_after') - BigInt('$buyer_before') + BigInt('$gas_cost')).toString()")
[ "$payout" = "8000000000000000" ] || fail "buyer payout is $payout wei, expected 0.008 ETH"
[ "$(cast nonce "$BUYER" --rpc-url "$RPC")" = "$((buyer_nonce + 1))" ] || fail "buyer nonce moved unexpectedly"
echo "claim Settled | buyer +0.008 ETH | Recovery NFT -> provider | SupplyRight NFT -> buyer | vault 0.002 ETH"

step "negative / security checks (forked simulation against the deployed contracts)"
script script/CheckPermissions.s.sol:CheckPermissions | grep -E "PASS|FAIL|checks" || fail "permission checks failed"

step "direct ETH transfer between two role wallets (buyer -> verifier, 0.001 ETH)"
v_before=$(cast balance "$VERIFIER" --rpc-url "$RPC")
tx=$(cast send "$VERIFIER" --value 0.001ether --private-key "$BUYER_KEY" --rpc-url "$RPC" --json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).transactionHash')
v_after=$(cast balance "$VERIFIER" --rpc-url "$RPC")
[ "$(node -p "(BigInt('$v_after') - BigInt('$v_before')).toString()")" = "1000000000000000" ] || fail "ETH transfer"
echo "transfer $tx: verifier +0.001 ETH"

step "measured gas per transaction (Anvil, same bytecode as Sepolia)"
START="$START" node - <<'NODE'
const fs = require("fs");
const start = Number(process.env.START);
const runs = [["Deploy", "Deploy.s.sol"], ["SetupRoles", "SetupRoles.s.sol"], ["E2E", "RunSepoliaE2E.s.sol"]];
const totals = {};
for (const [label, dir] of runs) {
  const base = `broadcast/${dir}/31337`;
  if (!fs.existsSync(base)) continue;
  const files = fs.readdirSync(base).filter(f => /^run-\d+\.json$/.test(f)).sort();
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(`${base}/${f}`, "utf8"));
    const ts = Number(r.timestamp);
    if ((ts > 1e12 ? ts / 1000 : ts) < start) continue; // runs against earlier local chains
    r.transactions.forEach((t, i) => {
      const gas = Number(BigInt(r.receipts[i].gasUsed));
      const name = t.transactionType === "CREATE" ? `create ${t.contractName}` : `${t.contractName ? t.contractName + "." : ""}${(t.function ?? "").split("(")[0]}`;
      const from = t.transaction.from.toLowerCase();
      totals[from] = (totals[from] ?? 0) + gas;
      console.log(`${label.padEnd(10)} ${name.padEnd(52)} ${String(gas).padStart(9)}`);
    });
  }
}
const names = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": "deployer",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65": "admin",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "buyer",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "provider",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": "verifier",
};
console.log("\ngas by signer:");
for (const [a, g] of Object.entries(totals)) console.log(`  ${(names[a] ?? a).padEnd(9)} ${g}`);
fs.writeFileSync("deployments/31337-gas-profile.json", JSON.stringify(Object.fromEntries(
  Object.entries(totals).map(([a, g]) => [names[a] ?? a, g])), null, 2) + "\n");
NODE
cp deployments/31337-gas-profile.json "$ROOT/config/gas-profile.anvil.json"

printf '\nANVIL INTEGRATION: PASS\n'
