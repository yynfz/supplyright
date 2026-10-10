#!/usr/bin/env bash
# Deploy SupplyRight on this VPS (run from the repository root).
# Used both by hand and by .github/workflows/deploy.yml over SSH.
#
# The chain the site serves comes from web/.env.local, so this script covers both setups:
#   * hosted demo chain  : NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=true,  NEXT_PUBLIC_DEFAULT_CHAIN_ID=31337
#   * Sepolia production : NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=false, NEXT_PUBLIC_DEFAULT_CHAIN_ID=11155111
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="web/.env.local"
SITE_URL="${SITE_URL:-https://supplyright.mufakat.id}"

fail() { echo "FAILED: $*" >&2; exit 1; }
env_val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found (it holds the Supabase keys and the chain config)"

EXPECTED_CHAIN="$(env_val NEXT_PUBLIC_DEFAULT_CHAIN_ID)"
ENABLE_LOCAL_CHAIN="$(env_val NEXT_PUBLIC_ENABLE_LOCAL_CHAIN)"
[ -n "$EXPECTED_CHAIN" ] || fail "NEXT_PUBLIC_DEFAULT_CHAIN_ID missing from $ENV_FILE"
echo "==> target chain: $EXPECTED_CHAIN (local chain enabled: ${ENABLE_LOCAL_CHAIN:-true})"

echo "==> pulling latest main"
git fetch --prune origin
git pull --ff-only
echo "    commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

if [ "$ENABLE_LOCAL_CHAIN" != "false" ]; then
  echo "==> ensuring the local demo chain is up"
  docker compose up -d supplyright-anvil
else
  echo "==> local chain disabled in $ENV_FILE, leaving anvil untouched"
fi

# Contracts are read per request from this directory (mounted read-only into the container).
if [ -f "contracts/deployments/$EXPECTED_CHAIN.json" ]; then
  echo "    deployment file: contracts/deployments/$EXPECTED_CHAIN.json"
else
  echo "    WARNING: contracts/deployments/$EXPECTED_CHAIN.json is missing — the UI will report no deployment"
fi

# The web image inlines NEXT_PUBLIC_* at build time and BuildKit secrets are not part of the cache
# key, so the env file hash is passed as a build arg to force a rebuild when the environment changes.
echo "==> building the web image"
NEXT_PUBLIC_ENV_HASH="$(sha256sum "$ENV_FILE" | cut -c1-16)" docker compose build supplyright-web

echo "==> recreating the web container"
docker compose up -d supplyright-web

echo "==> smoke test"
code=""
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/" || true)"
  [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] || fail "$SITE_URL/ returned '$code'"

config="$(curl -s "$SITE_URL/api/config")"
case "$config" in
  *"\"$EXPECTED_CHAIN\""*) echo "    /api/config serves chain $EXPECTED_CHAIN" ;;
  *) fail "/api/config serves no chain $EXPECTED_CHAIN deployment: $config" ;;
esac

# The public RPC endpoint only exists while the local demo chain is part of the deployment.
if [ "$ENABLE_LOCAL_CHAIN" != "false" ] && [ "$EXPECTED_CHAIN" = "31337" ]; then
  chain="$(curl -s -X POST "$SITE_URL/rpc" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')"
  case "$chain" in
    *0x7a69*) echo "    /rpc reports chain 0x7a69" ;;
    *) fail "demo RPC chain id mismatch (want 0x7a69): $chain" ;;
  esac
fi

echo "OK: $(git rev-parse --short HEAD) is live at $SITE_URL on chain $EXPECTED_CHAIN"
