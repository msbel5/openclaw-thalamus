#!/usr/bin/env bash
set -euo pipefail

REPO="${THALAMUS_REPO:-$HOME/projects-alcyone/openclaw-thalamus}"
STATE_DIR="${THALAMUS_STATE_DIR:-$HOME/.openclaw/thalamus/state}"
LOG_FILE="$STATE_DIR/heartbeat_canary_runs.jsonl"
LOCK_FILE="$STATE_DIR/heartbeat_canary.lock"
CHAT_ID="${THALAMUS_CANARY_CHAT_ID:-1087797886}"

mkdir -p "$STATE_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '{"ts":"%s","ok":false,"error":"canary already running"}\n' "$(date --iso-8601=seconds)" >> "$LOG_FILE"
  exit 75
fi

cd "$REPO"
tmp="$(mktemp)"
if node src/cli.js heartbeat-canary --send --chat "$CHAT_ID" --keep-alive "${THALAMUS_CANARY_KEEP_ALIVE:-0s}" > "$tmp"; then
  python3 - "$tmp" "$LOG_FILE" <<'PYJSON'
import json, sys, time
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
data["run_ts"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
with open(dst, "a") as f:
    f.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
print(json.dumps(data, ensure_ascii=False, indent=2))
PYJSON
  rm -f "$tmp"
else
  status=$?
  python3 - "$tmp" "$LOG_FILE" "$status" <<'PYJSON'
import json, sys, time
src, dst, status = sys.argv[1], sys.argv[2], int(sys.argv[3])
body = open(src, errors="replace").read()
data = {"run_ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "ok": False, "exit_status": status, "output": body[-4000:]}
with open(dst, "a") as f:
    f.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
print(json.dumps(data, ensure_ascii=False, indent=2))
PYJSON
  rm -f "$tmp"
  exit "$status"
fi
