"""Video frame extraction helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path


def extract_frames(video_path: str, out_dir: str, fps: int = 1, max_frames: int = 30) -> list[str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pattern = out / "frame_%03d.png"
    subprocess.run(
        ["ffmpeg", "-y", "-nostdin", "-i", video_path, "-vf", f"fps={fps}", "-frames:v", str(max_frames), str(pattern)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return [str(path) for path in sorted(out.glob("frame_*.png"))]

