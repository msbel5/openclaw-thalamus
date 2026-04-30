#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

from encoder_server import HuggingFaceBackend, resolve_hf_home


def main() -> int:
    os.environ.setdefault("THALAMUS_ENCODER_BACKEND", "hf")
    hf_home = resolve_hf_home()
    backend = HuggingFaceBackend()
    image = fixture_ppm()
    vision = backend.encode("vision", image, None)
    text = backend.encode("text", b"", "a red square on a black background")

    print(f"backend={backend.name}")
    print(f"hf_home={hf_home}")
    print(f"vision_dim={len(vision)}")
    print(f"text_dim={len(text)}")

    if backend.name != "huggingface-cpu-fp32":
        print("expected backend=huggingface-cpu-fp32", file=sys.stderr)
        return 1
    if len(vision) != 768 or len(text) != 384:
        print("unexpected vector dimensions", file=sys.stderr)
        return 1
    return 0


def fixture_ppm() -> bytes:
    width = 64
    height = 64
    pixels = bytearray([0] * width * height * 3)
    for y in range(18, 46):
        for x in range(18, 46):
            offset = (y * width + x) * 3
            pixels[offset : offset + 3] = bytes((220, 48, 48))
    return b"P6\n64 64\n255\n" + bytes(pixels)


if __name__ == "__main__":
    raise SystemExit(main())
