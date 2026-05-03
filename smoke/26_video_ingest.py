import json
import subprocess
import tempfile
from pathlib import Path

from common import ROOT

with tempfile.TemporaryDirectory(prefix="thalamus-video-smoke-") as tmp:
    video = Path(tmp) / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=1:duration=5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=5",
            "-shortest",
            str(video),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    proc = subprocess.run(
        ["node", "src/cli.js", "ingest", "--video", str(video), "--source", "cli", "--intent", "video-smoke"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        print(json.dumps({"test": "26_video_ingest", "ok": False, "soft_fail": True, "reason": proc.stderr[-500:]}))
    else:
        payload = json.loads(proc.stdout)
        ok = bool(payload.get("packet_id") and len(payload.get("child_packet_ids", [])) >= 2)
        print(json.dumps({"test": "26_video_ingest", "ok": ok, "soft_fail": not ok, "packet_id": payload.get("packet_id"), "children": len(payload.get("child_packet_ids", []))}))

