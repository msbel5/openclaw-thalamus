import json
import subprocess
from pathlib import Path

from common import ROOT

image = ROOT / "smoke" / "assets" / "banner.png"
proc = subprocess.run(
    ["node", "src/cli.js", "ingest", "--image", str(image), "--source", "agent:builder", "--intent", "debug-state"],
    cwd=ROOT,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
if proc.returncode != 0:
    raise AssertionError(proc.stderr)
payload = json.loads(proc.stdout)
assert payload.get("packet_id"), payload
assert payload.get("resolver_key"), payload
assert "atoms.image.raw" in payload.get("stored_namespaces", []), payload
print(json.dumps({"test": "25_agent_ingest_handoff", "ok": True, "packet_id": payload["packet_id"]}))

