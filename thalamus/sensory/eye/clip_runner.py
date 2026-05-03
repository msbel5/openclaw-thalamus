"""CLIP image runner wrapper."""

from __future__ import annotations

import json
import subprocess
import sys


def embed_image(image_path: str) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "thalamus.vector.embed_image_clip", image_path],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    payload = json.loads(proc.stdout.strip() or "{}")
    if proc.returncode != 0:
        payload.setdefault("error", proc.stderr.strip() or "clip image encoder failed")
    return payload

