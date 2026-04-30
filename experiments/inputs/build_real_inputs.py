#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
from pathlib import Path


DEFAULT_COCO_ROOT = Path("D:/openclaw-thalamus-cache/data/coco_5k")
DEFAULT_OUTPUT = Path("experiments/inputs/real")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--coco-root", type=Path, default=default_coco_root())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--labels", type=Path, default=DEFAULT_OUTPUT / "labels.csv")
    parser.add_argument("--count", type=int, default=50)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    if not args.labels.exists():
        write_label_template(args.coco_root, args.output, args.labels, args.count)
        print("labeling pending")
        print(f"Open {args.output / 'labeling_candidates.csv'} and fill:")
        print("dominant_color, primary_shape, noun_phrase")
        print(f"Save the completed file as {args.labels}, then rerun this script.")
        return 2

    labels = read_labels(args.labels)
    if len(labels) < args.count:
        raise SystemExit(f"{args.labels} has {len(labels)} labels, expected at least {args.count}")

    manifest_path = args.output / "manifest.jsonl"
    with manifest_path.open("w", encoding="utf8") as manifest:
        for index, label in enumerate(labels[: args.count], start=1):
            image_name = f"image_{index:03d}.jpg"
            qa_name = f"image_{index:03d}.qa.jsonl"
            shutil.copyfile(label["image"], args.output / image_name)
            qa_rows = [
                {
                    "id": "q1",
                    "question": "what is the dominant color?",
                    "expectedAnswer": label["dominant_color"],
                    "color": label["dominant_color"],
                    "shape": label["primary_shape"],
                },
                {
                    "id": "q2",
                    "question": "what shape best describes the object?",
                    "expectedAnswer": label["primary_shape"],
                    "color": label["dominant_color"],
                    "shape": label["primary_shape"],
                },
                {
                    "id": "q3",
                    "question": "describe the object in one short noun phrase",
                    "expectedAnswer": label["noun_phrase"],
                    "color": label["dominant_color"],
                    "shape": label["primary_shape"],
                },
            ]
            with (args.output / qa_name).open("w", encoding="utf8") as qa:
                for row in qa_rows:
                    qa.write(json.dumps(row) + "\n")
            manifest.write(json.dumps({"id": f"real-{index:03d}", "image": image_name, "qa": qa_name}) + "\n")

    print(f"wrote {args.count} real inputs to {args.output}")
    return 0


def default_coco_root() -> Path:
    if os.name == "nt" and Path("D:/").exists():
        return DEFAULT_COCO_ROOT
    return Path.home() / ".cache" / "openclaw-thalamus" / "data" / "coco_5k"


def write_label_template(coco_root: Path, output: Path, labels_path: Path, count: int) -> None:
    manifest = coco_root / "manifest.jsonl"
    if not manifest.exists():
        raise SystemExit(f"missing COCO manifest: {manifest}; run adapters/download_coco_5k.py first")

    rows = []
    for line in manifest.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        caption = Path(item["caption"]).read_text(encoding="utf8").strip()
        rows.append(
            {
                "source_id": item["id"],
                "image": item["image"],
                "caption": caption,
                "dominant_color": "",
                "primary_shape": "",
                "noun_phrase": "",
            }
        )
        if len(rows) >= max(count * 2, count):
            break

    template = output / "labeling_candidates.csv"
    with template.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote label template: {template}")


def read_labels(labels_path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with labels_path.open("r", newline="", encoding="utf8") as handle:
        for row in csv.DictReader(handle):
            required = ["image", "dominant_color", "primary_shape", "noun_phrase"]
            if all((row.get(key) or "").strip() for key in required):
                rows.append({key: (row.get(key) or "").strip().lower() for key in required})
    return rows


if __name__ == "__main__":
    raise SystemExit(main())
