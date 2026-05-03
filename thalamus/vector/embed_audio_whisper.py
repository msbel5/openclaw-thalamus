"""Hailo Whisper encoder CLI for raw 512d audio vectors."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

from ._hailo_runtime import (
    HAILO10H_MODEL_DIR,
    configure_paths,
    emit_error,
    emit_ok,
    first_output,
    l2_normalize,
    run_hailo_single,
)


MODEL_PATH = HAILO10H_MODEL_DIR / "base-whisper-encoder-10s.hef"
MODEL_NAME = "hailo-whisper-base-encoder-10s"


def _chunk_embedding(output: np.ndarray) -> np.ndarray:
    squeezed = np.asarray(output, dtype=np.float32).squeeze()
    if squeezed.ndim == 1:
        return squeezed
    if squeezed.shape[-1] == 512:
        seq = squeezed.reshape(-1, 512)
        return seq.mean(axis=0) + 0.5 * seq.std(axis=0)
    return squeezed.reshape(-1)[-512:]


def main() -> int:
    started = time.time()
    if len(sys.argv) < 2:
        emit_error("audio path argument is required", model=MODEL_NAME, started=started)
        return 1
    audio_path = Path(sys.argv[1]).expanduser()
    if not audio_path.exists():
        emit_error(f"audio not found: {audio_path}", model=MODEL_NAME, started=started)
        return 1
    try:
        configure_paths()
        from hailo_apps.python.standalone_apps.speech_recognition.audio_utils import (
            improve_audio,
            load_audio,
            preprocess_audio,
        )

        audio, _ = improve_audio(load_audio(str(audio_path)))
        chunks = preprocess_audio(audio, chunk_length=10, max_duration=600)
        if not chunks:
            raise RuntimeError("audio produced no 10s chunks")
        vectors = []
        for chunk in chunks:
            outputs = run_hailo_single(str(MODEL_PATH), chunk.astype(np.float32), input_type="FLOAT32", output_type="FLOAT32")
            vectors.append(_chunk_embedding(first_output(outputs)))
        vector = l2_normalize(np.stack(vectors, axis=0).mean(axis=0))
        emit_ok(
            vector,
            model=MODEL_NAME,
            latency_ms=int((time.time() - started) * 1000),
            extra={"hef": str(MODEL_PATH), "chunks": len(chunks), "input": str(audio_path)},
        )
        return 0
    except Exception as exc:
        emit_error(exc, model=MODEL_NAME, started=started)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
