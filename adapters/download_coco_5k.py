#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Iterable


DEFAULT_CACHE_ROOT = Path("D:/openclaw-thalamus-cache/data/coco_5k")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=default_data_root())
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()

    data_root = args.data_root
    data_root.mkdir(parents=True, exist_ok=True)
    manifest_path = data_root / "manifest.jsonl"
    existing = count_existing_entries(manifest_path)
    if existing >= args.limit:
        print(f"COCO 5K cache already present: {data_root} ({existing} entries)")
        return 0

    from datasets import load_dataset

    print(f"Downloading COCO validation pairs to {data_root}")
    print(f"HF_HOME={os.environ.get('HF_HOME', '')}")

    dataset = load_first_available_dataset()
    written = 0
    with manifest_path.open("w", encoding="utf8") as manifest:
        for row in dataset:
            image = extract_image(row)
            caption = extract_caption(row)
            if image is None or caption is None:
                continue

            entry_dir = data_root / f"{written:05d}"
            entry_dir.mkdir(parents=True, exist_ok=True)
            image_path = entry_dir / "image.jpg"
            caption_path = entry_dir / "caption.txt"
            image.convert("RGB").save(image_path, format="JPEG", quality=92)
            caption_path.write_text(caption.strip() + "\n", encoding="utf8")
            manifest.write(
                json.dumps(
                    {
                        "id": f"{written:05d}",
                        "image": str(image_path),
                        "caption": str(caption_path),
                    }
                )
                + "\n"
            )
            written += 1
            if written % 250 == 0:
                print(f"cached {written}/{args.limit}")
            if written >= args.limit:
                break

    if written < args.limit:
        raise SystemExit(f"only wrote {written} usable COCO pairs")

    print(f"COCO 5K cache complete: {data_root} ({written} entries)")
    return 0


def default_data_root() -> Path:
    if os.name == "nt" and Path("D:/").exists():
        return DEFAULT_CACHE_ROOT
    return Path.home() / ".cache" / "openclaw-thalamus" / "data" / "coco_5k"


def count_existing_entries(manifest_path: Path) -> int:
    if not manifest_path.exists():
        return 0
    return sum(1 for line in manifest_path.read_text(encoding="utf8").splitlines() if line.strip())


def load_first_available_dataset() -> Iterable[dict[str, Any]]:
    from datasets import load_dataset

    attempts = [
        ("jxie/coco_captions", {"split": "train", "streaming": True}),
        ("HuggingFaceM4/COCO", {"split": "validation"}),
        ("HuggingFaceM4/COCO", {"split": "train", "streaming": True}),
        ("nlphuji/mscoco_2014_5k_test_image_text_retrieval", {"split": "test"}),
    ]
    errors: list[str] = []
    for name, kwargs in attempts:
        try:
            return load_dataset(name, **kwargs)
        except Exception as exc:
            errors.append(f"{name}: {exc}")
    raise RuntimeError("could not load a COCO dataset mirror:\n" + "\n".join(errors))


def extract_image(row: dict[str, Any]) -> Any | None:
    for key in ("image", "jpg", "png"):
        value = row.get(key)
        if hasattr(value, "convert"):
            return value
    return None


def extract_caption(row: dict[str, Any]) -> str | None:
    for key in ("caption", "text", "sentences_raw"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, str):
                return first

    sentences = row.get("sentences")
    if isinstance(sentences, list) and sentences:
        first = sentences[0]
        if isinstance(first, dict):
            raw = first.get("raw") or first.get("caption")
            if isinstance(raw, str):
                return raw
        if isinstance(first, str):
            return first
    if isinstance(sentences, dict):
        raw = sentences.get("raw") or sentences.get("caption")
        if isinstance(raw, str):
            return raw

    captions = row.get("captions")
    if isinstance(captions, list) and captions:
        first = captions[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            raw = first.get("text") or first.get("caption")
            if isinstance(raw, str):
                return raw
    return None


if __name__ == "__main__":
    raise SystemExit(main())
