#!/usr/bin/env python3
import json
import subprocess

out = subprocess.check_output(
    ["node", "src/cli.js", "embed", "--text", "Builder writes code after vector search", "--namespace", "atoms.code", "--store"],
    text=True,
)
data = json.loads(out)
vec = data["embeddings"][0]["vector"]
print(json.dumps({"ok": data["ok"], "dim": len(vec), "namespace": data["embeddings"][0]["namespace"], "degraded": data["degraded"]}))
