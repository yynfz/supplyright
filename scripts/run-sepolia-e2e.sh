#!/usr/bin/env bash
# ==============================================================================
# SupplyRight - real Sepolia end-to-end run with the four role wallets.
#
#   bash scripts/run-sepolia-e2e.sh <command>
#
#   preflight  read-only: chain, config, keystores, balances, deployment
#   deploy     Deploy.s.sol signed by the existing deployer keystore (skipped if already deployed)
#   roles      SetupRoles.s.sol (idempotent; sends nothing when the matrix already holds)
#   setup      E2E steps 1-3  (admin mints/activates/records delivery, buyer requests, provider funds 0.010 ETH)
#   wait       waits until the delivery deadline has passed on Sepolia
#   claim      E2E steps 4-6  (buyer claims, verifier approves, verifier triggers atomic settlement)
#   smoke      direct ETH transfer buyer -> verifier (0.001 ETH)
#   check      negative/security checks as a forked simulation (no transactions)
#   status     read-only state of the E2E case
#   report     verifies every recorded tx receipt onchain and writes docs/SEPOLIA-E2E-RESULTS.md
#   all        preflight, deploy, roles, setup, wait, claim, smoke, check, report
#
# Every command that sends transactions first prints a dry run (forge simulation against live Sepolia state
# or the exact transfer), then asks you to type "yes". Forge/cast ask for each keystore password themselves;
# this script never sees, stores or passes a password or private key. `--slow` makes forge wait for each
# receipt before sending the next transaction. Contract steps resume from onchain state, so re-running after a
# failure never duplicates a settlement. The optional smoke transfer is logged per E2E_RUN_ID.
#
# Env: SEPOLIA_RPC_URL (default publicnode), E2E_RUN_ID (default SEPOLIA-E2E-001), E2E_DEADLINE_DELAY (300),
#      ETHERSCAN_API_KEY (optional: verify contracts on deploy)
#
# Rehearsal only (scripts/rehearse-sepolia-fork.sh): SIGNER_MODE=unlocked runs against a LOCAL Anvil fork of
# Sepolia with impersonated accounts instead of keystores; it refuses any non-localhost RPC. ASSUME_YES=1 is
# honoured only in that mode, so a real Sepolia run always asks for confirmation.
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/config/wallets.sepolia.json"
export PATH="$HOME/.foundry/bin:$PATH"
export SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
export E2E_RUN_ID="${E2E_RUN_ID:-SEPOLIA-E2E-001}"
RPC="$SEPOLIA_RPC_URL"
KEYSTORES="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"
cd "$ROOT/contracts"

cfg() { node -p "const c=require(process.argv[1]); ($1) ?? ''" "$CONFIG"; }
DEPLOYER=$(cfg "c.deployer.address");          DEPLOYER_ALIAS=$(cfg "c.deployer.keystoreAlias")
ADMIN=$(cfg "c.wallets.admin.address");        ADMIN_ALIAS=$(cfg "c.wallets.admin.keystoreAlias")
BUYER=$(cfg "c.wallets.buyer.address");        BUYER_ALIAS=$(cfg "c.wallets.buyer.keystoreAlias")
PROVIDER=$(cfg "c.wallets.provider.address");  PROVIDER_ALIAS=$(cfg "c.wallets.provider.keystoreAlias")
VERIFIER=$(cfg "c.wallets.verifier.address");  VERIFIER_ALIAS=$(cfg "c.wallets.verifier.keystoreAlias")
EXPLORER=$(cfg "c.explorer")

say() { printf '\n==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = "11155111" ] || die "RPC is not Sepolia (chain 11155111)"
SIGNER_MODE="${SIGNER_MODE:-keystore}"
case "$SIGNER_MODE" in
  keystore) ;;
  unlocked) case "$RPC" in http://127.0.0.1:*|http://localhost:*) ;; *) die "SIGNER_MODE=unlocked is for a local fork only" ;; esac ;;
  *) die "SIGNER_MODE must be keystore or unlocked" ;;
esac
# Signer flags for forge: explicit keystore paths (also support FOUNDRY_KEYSTORE_DIR), or --unlocked
# on the local fork rehearsal. Use a bash array so paths with spaces are kept intact.
signers() {
  SIGNER_ARGS=()
  if [ "$SIGNER_MODE" = unlocked ]; then SIGNER_ARGS=(--unlocked); return; fi
  local a
  for a in "$@"; do SIGNER_ARGS+=(--keystore "$KEYSTORES/$a"); done
}
eth() { cast balance --ether "$1" --rpc-url "$RPC"; }
confirm() {
  local ans
  if [ "$SIGNER_MODE" = unlocked ] && [ "${ASSUME_YES:-}" = 1 ]; then echo "$1 [fork rehearsal: auto-confirmed]"; return; fi
  read -r -p "$1 Type yes to send: " ans
  [ "$ans" = "yes" ] || { echo "Not confirmed - nothing sent."; exit 1; }
}
DEPLOYMENT="$ROOT/contracts/deployments/11155111.json"
CONTRACT_KEYS="supplyRightNFT protectionNFT recoveryClaimNFT vault claimManager"
deployed_addr() { [ -f "$DEPLOYMENT" ] && node -p "require(process.argv[1]).$1 ?? ''" "$DEPLOYMENT"; }
vault_addr() { deployed_addr vault; }
# Deployed = all five addresses in deployments/11155111.json carry code onchain.
deployed() {
  local k a
  for k in $CONTRACT_KEYS; do
    a=$(deployed_addr "$k") || return 1
    [ -n "$a" ] && [ "$(cast code "$a" --rpc-url "$RPC")" != "0x" ] || return 1
  done
}
# Copy the verified addresses into config/wallets.sepolia.json (read by the frontend and the report).
sync_config() {
  node -e '
    const fs = require("fs"); const [cfgFile, depFile] = process.argv.slice(1);
    const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")); const d = JSON.parse(fs.readFileSync(depFile, "utf8"));
    for (const k of Object.keys(cfg.contracts)) cfg.contracts[k] = d[k];
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
  ' "$CONFIG" "$DEPLOYMENT"
}
# Forge's printed gas estimate comes from its local pre-Glamsterdam simulation and is far too low on Sepolia,
# so dry runs hide it; real sends use --skip-simulation, which makes the Sepolia node estimate every tx.
GAS_NOTE="gas: estimated by the Sepolia node for each transaction at send time (see scripts/prepare-funding.mjs for the budget)"
forge_sim() { forge script "$@" --rpc-url sepolia; }
forge_send() { forge script "$@" --rpc-url sepolia --broadcast --slow --skip-simulation; }

preflight() {
  say "preflight (read-only)"
  [ "$(cast chain-id --rpc-url "$RPC")" = "11155111" ] || die "RPC is not Sepolia"
  node -e '
    const c = require(process.argv[1]);
    const addresses = [c.deployer.address, ...Object.values(c.wallets).map(w => w.address)];
    if (addresses.length !== 5 || !addresses.every(a => /^0x[0-9a-fA-F]{40}$/.test(a))
        || new Set(addresses.map(a => a.toLowerCase())).size !== 5) process.exit(1);
  ' "$CONFIG" || die "deployer and role addresses in config must be valid and distinct"
  echo "RPC $(echo "$RPC" | sed -E 's#(https?://[^/]+).*#\1/...#') - block $(cast block-number --rpc-url "$RPC"), gas price $(cast gas-price --rpc-url "$RPC") wei"
  for a in "$DEPLOYER_ALIAS" "$ADMIN_ALIAS" "$BUYER_ALIAS" "$PROVIDER_ALIAS" "$VERIFIER_ALIAS"; do
    [ -f "$KEYSTORES/$a" ] || [ "$SIGNER_MODE" = unlocked ] || die "keystore $a not found in $KEYSTORES"
  done
  if [ "$SIGNER_MODE" = keystore ]; then
    local expected actual
    for a in "$DEPLOYER_ALIAS" "$ADMIN_ALIAS" "$BUYER_ALIAS" "$PROVIDER_ALIAS" "$VERIFIER_ALIAS"; do
      case "$a" in
        "$DEPLOYER_ALIAS") expected="$DEPLOYER" ;;
        "$ADMIN_ALIAS") expected="$ADMIN" ;;
        "$BUYER_ALIAS") expected="$BUYER" ;;
        "$PROVIDER_ALIAS") expected="$PROVIDER" ;;
        "$VERIFIER_ALIAS") expected="$VERIFIER" ;;
      esac
      echo "Verify $a (hidden keystore password prompt):"
      actual=$(cast wallet address --keystore "$KEYSTORES/$a")
      [ "${actual,,}" = "${expected,,}" ] || die "$a resolves to $actual, but config expects $expected"
    done
  fi
  printf '%-9s %-42s %s\n' role address "balance (ETH)"
  printf '%-9s %-42s %s\n' deployer "$DEPLOYER" "$(eth "$DEPLOYER")" admin "$ADMIN" "$(eth "$ADMIN")" \
    buyer "$BUYER" "$(eth "$BUYER")" provider "$PROVIDER" "$(eth "$PROVIDER")" verifier "$VERIFIER" "$(eth "$VERIFIER")"
  if deployed; then
    echo "contracts deployed: vault $(vault_addr) holds $(eth "$(vault_addr)") ETH"
  else
    echo "contracts: not deployed yet"
  fi
}

deploy() {
  if deployed; then
    say "deploy: already deployed at vault $(vault_addr) - skipping"
    sync_config
    return
  fi
  # A prior broadcast may have created some contracts before failing. A second deploy would create
  # a fresh set and strand those contracts, so require recovery from the recorded broadcast first.
  if [ -f "$DEPLOYMENT" ] || [ -f "$ROOT/contracts/broadcast/Deploy.s.sol/11155111/run-latest.json" ]; then
    die "an earlier Sepolia deployment or broadcast exists but its five contracts are not verified; inspect the receipts and resume/reconcile it before deploying again"
  fi
  say "deploy - dry run against Sepolia (nothing is sent)"
  local out
  out=$(forge_sim script/Deploy.s.sol:Deploy --sender "$DEPLOYER") || die "deploy dry run failed: $out"
  echo "$out" | grep -E "deployed|role|Dry run" || true
  echo "$GAS_NOTE"
  echo "deployer $DEPLOYER holds $(eth "$DEPLOYER") ETH"
  confirm "Deploy the 5 contracts and assign the role matrix from $DEPLOYER ($DEPLOYER_ALIAS)?"
  local verify=()
  [ -n "${ETHERSCAN_API_KEY:-}" ] && verify=(--verify)
  signers "$DEPLOYER_ALIAS"
  forge_send script/Deploy.s.sol:Deploy "${SIGNER_ARGS[@]}" --sender "$DEPLOYER" "${verify[@]}"
  deployed || die "deployment not visible onchain; re-run deploy after checking the forge output"
  sync_config
  echo "verified code onchain for: $CONTRACT_KEYS; addresses saved in config/wallets.sepolia.json"
}

roles() {
  say "roles - dry run"
  local out role signer alias
  role="${SETUP_ROLES_AS:-deployer}"
  case "$role" in
    deployer) signer="$DEPLOYER"; alias="$DEPLOYER_ALIAS" ;;
    admin) signer="$ADMIN"; alias="$ADMIN_ALIAS" ;;
    *) die "SETUP_ROLES_AS must be deployer or admin" ;;
  esac
  if [ "$role" = admin ] && [ "${RENOUNCE_DEPLOYER_ADMIN:-false}" = true ]; then
    die "RENOUNCE_DEPLOYER_ADMIN=true requires SETUP_ROLES_AS=deployer"
  fi
  out=$(forge_sim script/SetupRoles.s.sol:SetupRoles --sender "$signer") || die "role setup dry run failed: $out"
  echo "$out" | grep -E "grants sent|verified|FAILED" || true
  if echo "$out" | grep -q "role grants sent: 0" && [ "${RENOUNCE_DEPLOYER_ADMIN:-false}" != true ]; then
    echo "role matrix already holds - nothing to send"
    return
  fi
  confirm "Send role setup from $signer ($alias), including any requested deployer admin renouncement?"
  signers "$alias"
  forge_send script/SetupRoles.s.sol:SetupRoles "${SIGNER_ARGS[@]}" --sender "$signer"
}

setup() {
  say "E2E setup (steps 1-3) - dry run against Sepolia"
  local out
  out=$(E2E_PHASE=setup forge_sim script/RunSepoliaE2E.s.sol:RunSepoliaE2E --sender "$ADMIN") || die "setup dry run failed: $out"
  echo "$out" | grep -E "^\s*\[|NFT #|escrow" || true
  echo "$GAS_NOTE"
  confirm "Send steps 1-3 signed by admin, buyer and provider (provider sends the 0.010 ETH escrow)?"
  echo "forge asks for the keystore passwords in this order: $ADMIN_ALIAS, $BUYER_ALIAS, $PROVIDER_ALIAS"
  signers "$ADMIN_ALIAS" "$BUYER_ALIAS" "$PROVIDER_ALIAS"
  E2E_PHASE=setup forge_send script/RunSepoliaE2E.s.sol:RunSepoliaE2E \
    "${SIGNER_ARGS[@]}" --sender "$ADMIN"
}

deadline() {
  local rights ref id raw
  rights=$(deployed_addr supplyRightNFT)
  ref=$(cast keccak "SupplyRight/$E2E_RUN_ID/PO")
  id=$(cast call "$rights" "tokenIdByPoRef(bytes32)(uint256)" "$ref" --rpc-url "$RPC")
  [ "$id" != "0" ] || die "no supply right for run $E2E_RUN_ID yet; run setup first"
  raw=$(cast call "$rights" "getSupplyRight(uint256)" "$id" --rpc-url "$RPC") # word 1 = deliveryDeadline
  echo $((16#${raw:$((2 + 64)):64}))
}

wait_deadline() {
  local d now
  d=$(deadline)
  say "waiting for the delivery deadline ($d) to pass on Sepolia"
  while :; do
    now=$(cast block --field timestamp --rpc-url "$RPC" latest)
    [ "$now" -gt "$d" ] && break
    echo "  chain time $now, $((d - now + 1)) s to go"
    sleep 15
    # A local fork only produces blocks on demand.
    if [ "$SIGNER_MODE" = unlocked ]; then cast rpc evm_mine --rpc-url "$RPC" >/dev/null; fi
  done
  echo "  deadline passed (chain time $now)"
}

claim() {
  say "E2E claim (steps 4-6) - dry run against Sepolia"
  local out
  out=$(E2E_PHASE=claim forge_sim script/RunSepoliaE2E.s.sol:RunSepoliaE2E --sender "$BUYER") || die "claim dry run failed: $out"
  echo "$out" | grep -E "^\s*\[|claim #|Recovery|Economics|NOTE" || true
  echo "$GAS_NOTE"
  confirm "Send steps 4-6 signed by buyer and verifier (claim, approval, atomic settlement)?"
  echo "forge asks for the keystore passwords in this order: $BUYER_ALIAS, $VERIFIER_ALIAS"
  signers "$BUYER_ALIAS" "$VERIFIER_ALIAS"
  E2E_PHASE=claim forge_send script/RunSepoliaE2E.s.sol:RunSepoliaE2E \
    "${SIGNER_ARGS[@]}" --sender "$BUYER"
}

smoke() {
  say "direct ETH transfer smoke test"
  local log="$ROOT/contracts/deployments/11155111-transfers.json"
  local previous receipt tx
  previous=$(node -e '
    const fs = require("fs"); const [file, runId] = process.argv.slice(1);
    const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const row = rows.find(r => r.runId === runId && r.label === "ETH transfer buyer -> verifier (0.001 ETH)");
    if (row) process.stdout.write(row.hash);
  ' "$log" "$E2E_RUN_ID")
  if [ -n "$previous" ]; then
    receipt=$(cast receipt "$previous" --rpc-url "$RPC" --json) || die "recorded smoke transfer $previous has no receipt; inspect before retrying"
    tx=$(cast tx "$previous" --rpc-url "$RPC" --json) || die "recorded smoke transfer $previous has no transaction; inspect before retrying"
    node -e '
      const [receipt, tx, from, to] = process.argv.slice(1);
      const r = JSON.parse(receipt), t = JSON.parse(tx);
      if (BigInt(r.status) !== 1n || t.from.toLowerCase() !== from.toLowerCase()
          || t.to.toLowerCase() !== to.toLowerCase() || BigInt(t.value) !== 1000000000000000n)
        process.exit(1);
    ' "$receipt" "$tx" "$BUYER" "$VERIFIER" || die "recorded smoke transfer $previous does not match the expected successful transfer"
    echo "smoke transfer already confirmed for $E2E_RUN_ID: $previous"
    echo "$EXPLORER/tx/$previous"
    return
  fi
  echo "source      $BUYER ($BUYER_ALIAS), balance $(eth "$BUYER") ETH"
  echo "destination $VERIFIER ($VERIFIER_ALIAS)"
  echo "amount      0.001 ETH, gas 21000 x $(cast gas-price --rpc-url "$RPC") wei"
  if [ "$SIGNER_MODE" = keystore ]; then
    local actual
    actual=$(cast wallet address --keystore "$KEYSTORES/$BUYER_ALIAS")
    [ "${actual,,}" = "${BUYER,,}" ] || die "$BUYER_ALIAS resolves to $actual, but config expects $BUYER"
  fi
  confirm "Send 0.001 ETH from buyer to verifier?"
  local out hash
  local from=(--keystore "$KEYSTORES/$BUYER_ALIAS")
  [ "$SIGNER_MODE" = unlocked ] && from=(--unlocked --from "$BUYER")
  out=$(cast send "$VERIFIER" --value 0.001ether "${from[@]}" --rpc-url "$RPC" --json)
  hash=$(printf '%s' "$out" | node -e '
    const r = JSON.parse(require("fs").readFileSync(0,"utf8"));
    if (BigInt(r.status) !== 1n || !r.transactionHash) process.exit(1);
    process.stdout.write(r.transactionHash);
  ') || die "smoke transfer did not receive a successful receipt; inspect the cast output before retrying"
  mkdir -p "$ROOT/contracts/deployments"
  node -e '
    const fs = require("fs"); const [file, runId, hash, from, to] = process.argv.slice(1);
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    list.push({ runId, label: "ETH transfer buyer -> verifier (0.001 ETH)", hash, from, to });
    fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
  ' "$log" "$E2E_RUN_ID" "$hash" "$BUYER" "$VERIFIER"
  echo "tx $hash"
  echo "$EXPLORER/tx/$hash"
}

check() {
  say "negative / security checks against live Sepolia contracts (forked simulation, no transactions)"
  forge_sim script/CheckPermissions.s.sol:CheckPermissions | grep -E "PASS|FAIL|checks|skipped|role" || die "checks failed"
}

status() {
  E2E_PHASE=status forge_sim script/RunSepoliaE2E.s.sol:RunSepoliaE2E | sed -n '/=== SupplyRight/,$p' | grep -v "^\s*$" | grep -v "SIMULATION\|Setting up"
}

report() {
  say "verifying recorded transactions onchain and writing docs/SEPOLIA-E2E-RESULTS.md"
  node "$ROOT/web/scripts/sepolia-e2e-report.mjs"
}

cmd="${1:-preflight}"
case "$cmd" in
  preflight|deploy|roles|setup|claim|smoke|check|status|report) "$cmd" ;;
  wait) wait_deadline ;;
  all) preflight; deploy; roles; setup; wait_deadline; claim; smoke; check; report ;;
  *) die "unknown command '$cmd' (see the header of this script)" ;;
esac
