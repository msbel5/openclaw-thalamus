"""Source-agnostic video ingest helper.

PRD-A v0.4: Frames and audio are now copied to a permanent payload directory
(~/.openclaw/thalamus/state/payloads/<sha16>/) before atom rows reference them.
This prevents the "/tmp time-bomb" issue where ephemeral paths broke 52/81 atoms
on next OS reboot or tmpfs cleanup.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

from .audio_extract import extract_audio
from .frame_extract import extract_frames


PAYLOAD_ROOT = Path(os.environ.get(
    "THALAMUS_PAYLOAD_DIR",
    str(Path.home() / ".openclaw" / "thalamus" / "state" / "payloads"),
))


def _sha16(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _persist(tmp_path: str, label: str) -> str:
    """Copy a file from /tmp to a content-addressed permanent path. Returns new path."""
    src = Path(tmp_path)
    if not src.exists():
        return tmp_path  # nothing to do
    sha = _sha16(src.read_bytes())
    dst_dir = PAYLOAD_ROOT / sha
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / src.name
    if not dst.exists() or dst.stat().st_size != src.stat().st_size:
        shutil.copy2(str(src), str(dst))
    return str(dst)


def run(video_path: str, source: str = "unknown", intent: str | None = None, fps: int = 1, max_frames: int = 30) -> dict:
    src = Path(video_path).expanduser()
    with tempfile.TemporaryDirectory(prefix="thalamus-video-") as tmp:
        frames_tmp = extract_frames(str(src), str(Path(tmp) / "frames"), fps=fps, max_frames=max_frames)
        audio_tmp = extract_audio(str(src), str(Path(tmp) / "audio.wav"))
        # Persist BEFORE TemporaryDirectory exits (which would delete /tmp/...)
        frames = [_persist(p, "frame") for p in (frames_tmp or [])]
        audio = _persist(audio_tmp, "audio") if audio_tmp else None
        return {
            "ok": bool(frames or audio),
            "source": source,
            "intent": intent,
            "input": str(src),
            "frames": frames,
            "audio": audio,
            "payload_root": str(PAYLOAD_ROOT),
            "degraded": False,
        }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("video_path")
    parser.add_argument("--source", default="manual")
    parser.add_argument("--intent")
    parser.add_argument("--fps", type=int, default=1)
    parser.add_argument("--max-frames", type=int, default=30)
    args = parser.parse_args()
    print(json.dumps(run(args.video_path, source=args.source, intent=args.intent, fps=args.fps, max_frames=args.max_frames), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
