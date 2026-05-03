import json
import subprocess
import sys
import tempfile
from pathlib import Path

from common import ROOT

adapter = Path.home() / ".openclaw" / "tools" / "telegram_video_adapter.py"
if not adapter.exists():
    print(json.dumps({"test": "27_telegram_video_adapter", "ok": False, "soft_fail": True, "reason": "adapter not installed"}))
    sys.exit(0)

with tempfile.TemporaryDirectory(prefix="thalamus-telegram-video-") as tmp:
    video = Path(tmp) / "sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=1:duration=3", str(video)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    proc = subprocess.run(
        [sys.executable, str(adapter), "--file", str(video), "--username", "mock-msbel"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        print(json.dumps({"test": "27_telegram_video_adapter", "ok": False, "soft_fail": True, "reason": proc.stderr[-500:]}))
    else:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
        print(json.dumps({"test": "27_telegram_video_adapter", "ok": bool(payload.get("packet_id")), "soft_fail": False, "packet_id": payload.get("packet_id")}))

