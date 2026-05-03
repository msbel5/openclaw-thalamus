"""OCR wrapper for Turkish and English text."""

from __future__ import annotations

import subprocess


def run_ocr(image_path: str) -> dict:
    proc = subprocess.run(
        ["tesseract", image_path, "stdout", "-l", "tur+eng"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return {
        "ok": proc.returncode == 0,
        "text": proc.stdout.strip() or None,
        "degraded": proc.returncode != 0,
        "error": proc.stderr.strip() if proc.returncode != 0 else None,
    }

