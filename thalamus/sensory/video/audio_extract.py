"""Video audio extraction helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path


def extract_audio(video_path: str, output_path: str) -> str | None:
    dst = Path(output_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-nostdin", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", str(dst)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return str(dst) if proc.returncode == 0 and dst.exists() and dst.stat().st_size else None

