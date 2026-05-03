"""Source-agnostic video ingest helper."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from .audio_extract import extract_audio
from .frame_extract import extract_frames


def run(video_path: str, source: str = "unknown", intent: str | None = None, fps: int = 1, max_frames: int = 30) -> dict:
    src = Path(video_path).expanduser()
    with tempfile.TemporaryDirectory(prefix="thalamus-video-") as tmp:
        frames = extract_frames(str(src), str(Path(tmp) / "frames"), fps=fps, max_frames=max_frames)
        audio = extract_audio(str(src), str(Path(tmp) / "audio.wav"))
        return {
            "ok": bool(frames or audio),
            "source": source,
            "intent": intent,
            "input": str(src),
            "frames": frames,
            "audio": audio,
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

