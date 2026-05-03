"""Placeholder training entrypoint for future trained vector adapters.

v0.2 intentionally does not spend six unattended hours training on the Pi.
It verifies the cache path and leaves deterministic projection weights in
place. Add paired MiniLM/CLIP and audio/text data under
~/projects-alcyone/datasets/embedding_pairs/ before enabling real training.
"""

from __future__ import annotations

from pathlib import Path

from .normalizer import CACHE_DIR


DATA_DIR = Path.home() / "projects-alcyone" / "datasets" / "embedding_pairs"


def main() -> int:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(
        {
            "ok": True,
            "mode": "fallback-projection-cache-ready",
            "cache_dir": str(CACHE_DIR),
            "data_dir": str(DATA_DIR),
            "trained_weights": [],
            "next": "Add paired MiniLM/CLIP and audio-caption embeddings, then replace this stub with a small AdamW linear-projection trainer.",
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
