#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== 1. Architecture check ==="
test "$(uname -m)" = "aarch64" || { echo "Not ARM64"; exit 1; }

echo "=== 2. Node version ==="
node --version | grep -E "v(20|22)" >/dev/null || { echo "Need Node 20 or 22"; exit 1; }

echo "=== 3. Plugin loaded ==="
openclaw plugins list 2>&1 | grep thalamus >/dev/null || { echo "Plugin not loaded"; exit 1; }
openclaw plugins inspect thalamus --json >/tmp/thalamus-plugin-inspect.json 2>/tmp/thalamus-plugin-inspect.err || {
  cat /tmp/thalamus-plugin-inspect.err
  echo "Plugin inspect failed"
  exit 1
}

echo "=== 4. MCP tools exposed ==="
for tool in thalamus_encode thalamus_route thalamus_recall; do
  if ! grep "$tool" /tmp/thalamus-plugin-inspect.json >/dev/null; then
    echo "Tool $tool not exposed"
    exit 1
  fi
done

echo "=== 5. Smoke test: encode text -> route -> recall ==="
if openclaw tool --help >/dev/null 2>&1; then
  PACKET="$(openclaw tool call thalamus_encode \
    --modality text \
    --text "Pi 5 smoke test packet" 2>&1 | jq -r .packet_id)"
  echo "Encoded: $PACKET"

  ROUTED="$(openclaw tool call thalamus_route 2>&1 | jq -r .packet_id)"
  test "$PACKET" = "$ROUTED" || { echo "Route mismatch"; exit 1; }
  echo "Routed:  $ROUTED"

  RECALLED="$(openclaw tool call thalamus_recall \
    --text-query "smoke test" 2>&1 | jq -r '.hits[0].packet_id')"
  test "$PACKET" = "$RECALLED" || { echo "Recall mismatch"; exit 1; }
  echo "Recalled: $RECALLED"
else
  echo "openclaw tool call CLI unavailable; using local plugin smoke runner"
  node "$ROOT_DIR/scripts/plugin-smoke.mjs"
fi

echo "=== 6. Memory durability ==="
shopt -s nullglob
dbs=( "$HOME"/.openclaw/agents/*/memory/thalamus.sqlite /mnt/nvme/openclaw/agents/*/memory/thalamus.sqlite )
if [ "${#dbs[@]}" -eq 0 ]; then
  echo "Warn: no SQLite db found (memory may be in-memory only)"
else
  printf 'Found memory db: %s\n' "${dbs[0]}"
fi

echo
echo "Pi 5 smoke test PASSED"
