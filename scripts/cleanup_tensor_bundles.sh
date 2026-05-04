#!/usr/bin/env bash
set -euo pipefail
DIR="${THALAMUS_TENSOR_BUNDLE_DIR:-$HOME/.openclaw/thalamus/state/tensor_bundles}"
NOW=$(date +%s); TTL=$((30*24*3600)); removed=0; kept=0
mkdir -p "$DIR"
shopt -s nullglob
for meta in "$DIR"/*.json; do
  keep=$(python3 - "$meta" "$NOW" "$TTL" <<'PY'
import json,sys,datetime
p,now,ttl=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
d=json.load(open(p)); refs=d.get('referenced_by_atoms') or []
if d.get('promoted') or refs: print('keep'); raise SystemExit
created=d.get('created_at') or ''
try: ts=datetime.datetime.fromisoformat(created.replace('Z','+00:00')).timestamp()
except Exception: ts=now
print('delete' if now-ts>ttl else 'keep')
PY
)
  if [ "$keep" = delete ]; then base="${meta%.json}"; rm -f "$base.f16" "$meta"; removed=$((removed+1)); else kept=$((kept+1)); fi
done
printf '{"ok":true,"removed":%s,"kept":%s,"dir":"%s"}\n' "$removed" "$kept" "$DIR"
