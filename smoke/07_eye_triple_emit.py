#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

sample = Path.home() / "projects-alcyone" / "hailo-apps" / "doc" / "images" / "banner.png"
out = subprocess.check_output(
    ["node", "src/cli.js", "embed", "--image", str(sample), "--text", "Hailo apps banner", "--store"],
    text=True,
)
data = json.loads(out)
names = sorted(set(e["namespace"] for e in data["embeddings"]))
print(json.dumps({"ok": data["ok"], "namespaces": names, "triple_emit": all(ns in names for ns in ["atoms.image.raw", "atoms.image.text", "atoms.crossmodal"])}))
