#!/usr/bin/env python3
from __future__ import annotations

import math
import sqlite3
import struct
import zlib
from pathlib import Path


ROOT = Path.cwd()
FIGURES = ROOT / "figures"
RESULT_FILES = [
    ("fixture", ROOT / "experiments" / "results-fixture.sqlite"),
    ("real", ROOT / "experiments" / "results-real.sqlite"),
    ("legacy", ROOT / "experiments" / "results.sqlite"),
]


def main() -> int:
    rows = load_rows()
    if not rows:
        raise SystemExit("no experiment rows found")

    FIGURES.mkdir(parents=True, exist_ok=True)
    grouped_bar(rows, "latency_ms", FIGURES / "latency_box.png", reducer=median)
    grouped_bar(rows, "token_count", FIGURES / "tokens_bar.png", reducer=average)
    grouped_bar(rows, "fidelity", FIGURES / "fidelity_hist.png", reducer=average)
    grouped_bar(rows, "task_success", FIGURES / "task_success.png", reducer=average)
    return 0


def load_rows() -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for suite, path in RESULT_FILES:
        if not path.exists():
            continue
        with sqlite3.connect(path) as db:
            db.row_factory = sqlite3.Row
            for row in db.execute("SELECT * FROM runs"):
                item = dict(row)
                item["suite"] = suite
                rows.append(item)
    return rows


def grouped_bar(rows: list[dict[str, float | str]], field: str, path: Path, reducer) -> None:
    image = Canvas(760, 440)
    suites = sorted({str(row["suite"]) for row in rows if str(row["suite"]) != "legacy"})
    if not suites:
        suites = ["legacy"]
    pipelines = ["text-bus", "thalamus"]
    values: dict[tuple[str, str], float] = {}
    for suite in suites:
        for pipeline in pipelines:
            metric_values = [
                float(row[field])
                for row in rows
                if str(row["suite"]) == suite and str(row["pipeline"]) == pipeline
            ]
            values[(suite, pipeline)] = reducer(metric_values) if metric_values else 0.0

    max_value = max(max(values.values()), 1.0)
    if field == "latency_ms":
        scale = 300 / max(1.0, math.log10(max_value + 1))
        transform = lambda value: math.log10(value + 1) * scale
    else:
        scale = 300 / max_value
        transform = lambda value: value * scale

    colors = {"text-bus": (50, 105, 200), "thalamus": (20, 150, 95)}
    x = 130
    for suite in suites:
        for pipeline in pipelines:
            height = int(transform(values[(suite, pipeline)]))
            image.rect(x - 26, 370 - height, x + 26, 370, colors[pipeline])
            x += 65
        x += 95
    image.axes()
    image.save(path)


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    middle = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[middle]
    return (sorted_values[middle - 1] + sorted_values[middle]) / 2


class Canvas:
    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        self.pixels = bytearray([255] * width * height * 3)

    def rect(self, x1: int, y1: int, x2: int, y2: int, color: tuple[int, int, int]) -> None:
        xa, xb = sorted((max(0, x1), min(self.width - 1, x2)))
        ya, yb = sorted((max(0, y1), min(self.height - 1, y2)))
        for y in range(ya, yb + 1):
            for x in range(xa, xb + 1):
                offset = (y * self.width + x) * 3
                self.pixels[offset : offset + 3] = bytes(color)

    def axes(self) -> None:
        self.rect(60, 40, 62, 370, (40, 40, 40))
        self.rect(60, 368, 700, 370, (40, 40, 40))

    def save(self, path: Path) -> None:
        raw = bytearray()
        for y in range(self.height):
            raw.append(0)
            start = y * self.width * 3
            raw.extend(self.pixels[start : start + self.width * 3])
        png = bytearray()
        png.extend(b"\x89PNG\r\n\x1a\n")
        png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)))
        png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        png.extend(chunk(b"IEND", b""))
        path.write_bytes(png)


def chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


if __name__ == "__main__":
    raise SystemExit(main())
