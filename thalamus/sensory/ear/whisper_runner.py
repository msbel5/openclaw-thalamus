"""Thin wrapper around local Whisper encoder/decoder assets."""

from __future__ import annotations

import json
import subprocess
import sys


def embed_audio(audio_path: str) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "thalamus.vector.embed_audio_whisper", audio_path],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    payload = json.loads(proc.stdout.strip() or "{}")
    if proc.returncode != 0:
        payload.setdefault("error", proc.stderr.strip() or "whisper encoder failed")
    return payload


def transcribe_audio(audio_path: str) -> dict:
    # Full decoder is intentionally not forced here; v0.2.1 stores raw audio
    # truth even when transcript generation is unavailable.
    return {"ok": False, "text": None, "lang": None, "degraded": True, "error": "decoder bridge not enabled in v0.2.1"}

