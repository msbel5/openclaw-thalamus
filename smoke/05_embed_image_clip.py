#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

sample = Path.home() / "projects-alcyone" / "hailo-apps" / "doc" / "images" / "banner.png"
out = subprocess.check_output(
    ["node", "src/cli.js", "embed", "--image", str(sample), "--store"],
    text=True,
)
data = json.loads(out)
raw = [e for e in data["embeddings"] if e["namespace"] == "atoms.image.raw"][0]
print(json.dumps({"ok": data["ok"], "dim": len(raw["vector"]), "namespace": raw["namespace"], "degraded": raw["degraded"]}))
