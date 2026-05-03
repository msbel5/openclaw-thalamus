"""Audio file conversion helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path


def to_wav_16k_mono(input_path: str, output_path: str) -> str:
    src = Path(input_path).expanduser()
    dst = Path(output_path).expanduser()
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-i",
            str(src),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            str(dst),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return str(dst)

