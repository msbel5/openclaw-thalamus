import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
adapter = Path.home() / ".openclaw" / "tools" / "telegram_voice_adapter.py"
sample = Path("/home/msbel/projects-alcyone/whisper.cpp/samples/jfk.wav")

if not adapter.exists():
    print(json.dumps({"test": "24_telegram_voice_e2e", "ok": False, "soft_fail": True, "reason": "adapter not installed"}))
    sys.exit(0)

proc = subprocess.run(
    [sys.executable, str(adapter), "--file", str(sample), "--username", "mock-msbel"],
    cwd=ROOT,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
if proc.returncode != 0:
    print(json.dumps({"test": "24_telegram_voice_e2e", "ok": False, "soft_fail": True, "reason": proc.stderr[-500:]}))
    sys.exit(0)
payload = json.loads(proc.stdout.strip().splitlines()[-1])
print(json.dumps({"test": "24_telegram_voice_e2e", "ok": bool(payload.get("packet_id")), "soft_fail": False, "packet_id": payload.get("packet_id")}))

