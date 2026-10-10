#!/usr/bin/env bash
# Deploy SupplyRight on this VPS (run from the repository root).
# Used both by hand and by .github/workflows/deploy.yml over SSH.
set -euo pipefail
cd "$(dirname "$0")/.."

SITE_URL="${SITE_URL:-https://supplyright.mufakat.id}"

echo "==> pulling latest main"
git fetch --prune origin
git pull --ff-only
echo "    commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "==> ensuring the demo chain is up"
docker compose up -d supplyright-anvil

# The web image inlines NEXT_PUBLIC_* at build time and BuildKit secrets are not part of the cache
# key, so the env file hash is passed as a build arg to force a rebuild when the environment changes.
echo "==> building the web image"
NEXT_PUBLIC_ENV_HASH="$(sha256sum web/.env.local | cut -c1-16)" docker compose build supplyright-web

echo "==> recreating the web container"
docker compose up -d supplyright-web

echo "==> smoke test"
code=""
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/" || true)"
  [ "$code" = "200" ] && break
  sleep 3
done
[ "$code" = "200" ] || { echo "FAILED: $SITE_URL/ returned '$code'"; exit 1; }

config="$(curl -s "$SITE_URL/api/config")"
case "$config" in
  *'"31337"'*) : ;;
  *) echo "FAILED: /api/config serves no chain 31337 deployment: $config"; exit 1 ;;
esac

chain="$(curl -s -X POST "$SITE_URL/rpc" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')"
case "$chain" in
  *0x7a69*) : ;;
  *) echo "FAILED: demo RPC chain id mismatch: $chain"; exit 1 ;;
esac

echo "OK: $(git rev-parse --short HEAD) is live at $SITE_URL"
