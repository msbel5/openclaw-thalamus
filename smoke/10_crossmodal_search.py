#!/usr/bin/env python3
import json
import subprocess

subprocess.check_call(
    ["node", "src/cli.js", "embed", "--text", "blue Hailo AI dashboard banner", "--namespace", "atoms.crossmodal", "--store"],
    stdout=subprocess.DEVNULL,
)
out = subprocess.check_output(
    ["node", "src/cli.js", "search", "--text", "AI dashboard banner", "--namespace", "atoms.crossmodal", "--top", "3"],
    text=True,
)
data = json.loads(out)
print(json.dumps({"ok": data["ok"], "namespace": data["namespace"], "matches": len(data["matches"]), "top": data["matches"][0]["id"] if data["matches"] else None}))
