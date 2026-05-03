"""Hailo CLIP image encoder CLI."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from ._hailo_runtime import HAILO10H_MODEL_DIR, emit_error, emit_ok, first_output, l2_normalize, run_hailo_single


MODEL_PATH = HAILO10H_MODEL_DIR / "clip_vit_b_32_image_encoder.hef"
MODEL_NAME = "hailo-clip-vit-b-32-image"


def preprocess(image_path: Path) -> np.ndarray:
    image = Image.open(image_path).convert("RGB")
    image = ImageOps.fit(image, (224, 224), method=Image.Resampling.BICUBIC, centering=(0.5, 0.5))
    return np.ascontiguousarray(np.asarray(image, dtype=np.uint8)[None, ...].copy())


def main() -> int:
    started = time.time()
    if len(sys.argv) < 2:
        emit_error("image path argument is required", model=MODEL_NAME, started=started)
        return 1
    image_path = Path(sys.argv[1]).expanduser()
    if not image_path.exists():
        emit_error(f"image not found: {image_path}", model=MODEL_NAME, started=started)
        return 1
    try:
        outputs = run_hailo_single(str(MODEL_PATH), preprocess(image_path), input_type="UINT8", output_type="FLOAT32")
        vector = l2_normalize(first_output(outputs))
        emit_ok(
            vector,
            model=MODEL_NAME,
            latency_ms=int((time.time() - started) * 1000),
            extra={"hef": str(MODEL_PATH), "input": str(image_path)},
        )
        return 0
    except Exception as exc:
        emit_error(exc, model=MODEL_NAME, started=started)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
