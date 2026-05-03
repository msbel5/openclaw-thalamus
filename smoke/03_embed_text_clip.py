#!/usr/bin/env python3
import json
import subprocess

out = subprocess.check_output(
    ["node", "src/cli.js", "embed", "--text", "A glowing dashboard image with agent packet graph", "--namespace", "atoms.crossmodal", "--store"],
    text=True,
)
data = json.loads(out)
cross = [e for e in data["embeddings"] if e["namespace"] == "atoms.crossmodal"][0]
print(json.dumps({"ok": data["ok"], "dim": len(cross["vector"]), "namespace": cross["namespace"], "degraded": cross["degraded"]}))
