"""Source-agnostic image ingest pipeline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .clip_runner import embed_image
from .ocr import run_ocr
from .vlm_caption import caption_image


def run(input_path: str, source: str = "unknown", intent: str | None = None, metadata: dict | None = None) -> dict[str, Any]:
    src = Path(input_path).expanduser()
    image = embed_image(str(src))
    ocr = run_ocr(str(src))
    caption = caption_image(str(src))
    return {
        "ok": bool(image.get("ok")),
        "source": source,
        "intent": intent,
        "input": str(src),
        "image_vec_512": image.get("vector"),
        "ocr": ocr.get("text"),
        "caption": caption.get("caption"),
        "degraded": bool(image.get("degraded") or ocr.get("degraded") or caption.get("degraded")),
        "metadata": metadata or {},
        "proof": {"image": image, "ocr": ocr, "caption": caption},
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("input_path")
    parser.add_argument("--source", default="manual")
    parser.add_argument("--intent")
    args = parser.parse_args()
    print(json.dumps(run(args.input_path, source=args.source, intent=args.intent), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

