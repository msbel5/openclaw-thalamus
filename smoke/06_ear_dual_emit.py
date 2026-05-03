#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

sample = Path.home() / "projects-alcyone" / "whisper.cpp" / "samples" / "jfk.wav"
out = subprocess.check_output(
    ["node", "src/cli.js", "embed", "--audio", str(sample), "--text", "JFK public speech sample", "--store"],
    text=True,
)
data = json.loads(out)
names = sorted(e["namespace"] for e in data["embeddings"])
print(json.dumps({"ok": data["ok"], "namespaces": names, "dual_emit": "atoms.audio.raw" in names and "atoms.audio.text" in names}))
