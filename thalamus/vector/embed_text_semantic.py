"""CPU multilingual semantic text encoder for Thalamus."""

from __future__ import annotations

import sys
import time

import numpy as np

from ._hailo_runtime import emit_error, emit_ok


MODEL_NAME = "distiluse-base-multilingual-cased-v2"


def embed_text(text: str) -> np.ndarray:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(MODEL_NAME)
    return model.encode([text], normalize_embeddings=True)[0].astype(np.float32)


def main() -> int:
    started = time.time()
    text = " ".join(sys.argv[1:]).strip()
    if not text:
        emit_error("text argument is required", model=MODEL_NAME, started=started)
        return 1
    try:
        vector = embed_text(text)
        emit_ok(vector, model=MODEL_NAME, latency_ms=int((time.time() - started) * 1000))
        return 0
    except Exception as exc:
        emit_error(exc, model=MODEL_NAME, started=started)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

