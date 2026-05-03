"""Hailo CLIP text encoder CLI."""

from __future__ import annotations

import sys
import time

from ._hailo_runtime import HAILO10H_MODEL_DIR, configure_paths, emit_error, emit_ok, l2_normalize


MODEL_PATH = HAILO10H_MODEL_DIR / "clip_vit_b_32_text_encoder.hef"
MODEL_NAME = "hailo-clip-vit-b-32-text"


def main() -> int:
    started = time.time()
    text = " ".join(sys.argv[1:]).strip()
    if not text:
        emit_error("text argument is required", model=MODEL_NAME, started=started)
        return 1
    try:
        configure_paths()
        from hailo_apps.python.pipeline_apps.clip.clip_text_utils import (
            DEFAULT_TEXT_PROJECTION_PATH,
            run_text_encoder_inference,
        )

        vec = run_text_encoder_inference(
            text,
            str(MODEL_PATH),
            text_projection_path=DEFAULT_TEXT_PROJECTION_PATH,
            timeout_ms=10000,
        )[0]
        emit_ok(
            l2_normalize(vec),
            model=MODEL_NAME,
            latency_ms=int((time.time() - started) * 1000),
            extra={"hef": str(MODEL_PATH)},
        )
        return 0
    except Exception as exc:
        emit_error(exc, model=MODEL_NAME, started=started)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

