#!/usr/bin/env python3
"""JSONL encoder server for OpenClaw Thalamus Phase 2.

The default backend is deterministic and CPU-only so Docker experiments are
reproducible on small machines. Set THALAMUS_ENCODER_BACKEND=hf to require
HuggingFace model loading. Explicit HF requests fail loudly if the backend is
unavailable; implicit/default runs keep the deterministic backend.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "white", "black"]
SHAPES = ["square", "circle", "triangle", "diamond", "bar"]
COLOR_RGB = {
    "red": (220, 48, 48),
    "blue": (48, 96, 220),
    "green": (56, 160, 88),
    "yellow": (224, 196, 48),
    "purple": (144, 80, 192),
    "orange": (232, 128, 48),
    "white": (230, 230, 230),
    "black": (16, 16, 16),
}


@dataclass
class ImageMetadata:
    color: str
    shape: str
    width: int
    height: int


class DeterministicBackend:
    name = "deterministic-cpu-fixture"

    def encode(self, modality: str, payload: bytes, text: str | None) -> list[float]:
        if modality == "vision":
            return self._vision(payload)
        if modality == "text":
            return self._text(text if text is not None else payload.decode("utf8", "replace"))
        if modality == "audio":
            return self._hash_vector(payload, 384)
        raise ValueError(f"unsupported modality: {modality}")

    def caption(self, payload: bytes) -> str:
        meta = parse_ppm_metadata(payload)
        if meta is not None:
            return f"a {meta.color} object on a black background"

        dominant = dominant_color(payload)
        return f"an image with dominant {dominant} tones"

    def _vision(self, payload: bytes) -> list[float]:
        meta = parse_ppm_metadata(payload)
        values = [0.0] * 768

        if meta is not None:
            if meta.color in COLORS:
                values[COLORS.index(meta.color)] = 3.0
            if meta.shape in SHAPES:
                values[16 + SHAPES.index(meta.shape)] = 3.0
            values[32] = meta.width / 256.0
            values[33] = meta.height / 256.0
        else:
            digest_values = self._hash_vector(payload, 64)
            values[:64] = digest_values

        tail = self._hash_vector(payload, 96)
        for index, value in enumerate(tail):
            values[96 + index] = value * 0.05

        return normalize(values)

    def _text(self, text: str) -> list[float]:
        values = [0.0] * 384
        lowered = text.lower()

        for index, color in enumerate(COLORS):
            if re.search(rf"\b{re.escape(color)}\b", lowered):
                values[index] = 2.0

        for index, shape in enumerate(SHAPES):
            if re.search(rf"\b{re.escape(shape)}\b", lowered):
                values[16 + index] = 2.0

        for token in re.findall(r"[a-z0-9]+", lowered):
            bucket = 64 + (stable_u32(token.encode("utf8")) % 256)
            values[bucket] += 0.25

        if all(value == 0.0 for value in values):
            values = self._hash_vector(text.encode("utf8"), 384)

        return normalize(values)

    def _hash_vector(self, payload: bytes, dim: int) -> list[float]:
        values: list[float] = []
        counter = 0
        while len(values) < dim:
            digest = hashlib.sha256(payload + counter.to_bytes(4, "big")).digest()
            for offset in range(0, len(digest), 4):
                if len(values) >= dim:
                    break
                unit = int.from_bytes(digest[offset : offset + 4], "big") / 0xFFFFFFFF
                values.append(unit * 2.0 - 1.0)
            counter += 1
        return normalize(values)


class HuggingFaceBackend:
    name = "huggingface-cpu-fp32"

    def __init__(self) -> None:
        import torch
        from PIL import Image
        from sentence_transformers import SentenceTransformer
        from transformers import AutoModel, AutoProcessor

        self.torch = torch
        self.image_class = Image
        self.hf_home = resolve_hf_home()
        self.siglip_processor = AutoProcessor.from_pretrained("google/siglip-base-patch16-224")
        self.siglip_model = AutoModel.from_pretrained("google/siglip-base-patch16-224").eval()
        self.text_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu")
        self.blip_processor = None
        self.blip_model = None
        self.whisper_processor = None
        self.whisper_model = None

    def encode(self, modality: str, payload: bytes, text: str | None) -> list[float]:
        if modality == "vision":
            return self._vision(payload)
        if modality == "text":
            return self._text(text if text is not None else payload.decode("utf8", "replace"))
        if modality == "audio":
            return self._audio(payload)
        raise ValueError(f"unsupported modality: {modality}")

    def caption(self, payload: bytes) -> str:
        import io

        self._ensure_blip()
        image = self.image_class.open(io.BytesIO(payload)).convert("RGB")
        inputs = self.blip_processor(images=image, return_tensors="pt")
        with self.torch.no_grad():
            output = self.blip_model.generate(**inputs, max_length=50, num_beams=3)
        return str(self.blip_processor.decode(output[0], skip_special_tokens=True)).strip()

    def _vision(self, payload: bytes) -> list[float]:
        import io

        image = self.image_class.open(io.BytesIO(payload)).convert("RGB")
        inputs = self.siglip_processor(images=image, return_tensors="pt")
        with self.torch.no_grad():
            features = self.siglip_model.get_image_features(**inputs)
        features = pooled_tensor(features)
        return normalize(features[0].detach().cpu().float().tolist())

    def _text(self, text: str) -> list[float]:
        return normalize(self.text_model.encode(text, normalize_embeddings=False).tolist())

    def _audio(self, payload: bytes) -> list[float]:
        # Raw audio decoding is deliberately conservative here. The default
        # deterministic fallback is used unless callers provide pre-decoded
        # float32 mono PCM bytes.
        floats = list(struct.unpack(f"<{len(payload) // 4}f", payload[: len(payload) - (len(payload) % 4)]))
        if not floats:
            return DeterministicBackend().encode("audio", payload, None)
        self._ensure_whisper()
        inputs = self.whisper_processor(floats, sampling_rate=16000, return_tensors="pt")
        with self.torch.no_grad():
            hidden = self.whisper_model.encoder(inputs.input_features).last_hidden_state
        pooled = hidden.mean(dim=1)[0][:384].detach().cpu().float().tolist()
        return normalize(pooled)

    def _ensure_blip(self) -> None:
        if self.blip_processor is not None and self.blip_model is not None:
            return

        from transformers import BlipForConditionalGeneration, BlipProcessor

        self.blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        self.blip_model = BlipForConditionalGeneration.from_pretrained(
            "Salesforce/blip-image-captioning-base"
        ).eval()

    def _ensure_whisper(self) -> None:
        if self.whisper_processor is not None and self.whisper_model is not None:
            return

        from transformers import WhisperModel, WhisperProcessor

        self.whisper_processor = WhisperProcessor.from_pretrained("openai/whisper-tiny")
        self.whisper_model = WhisperModel.from_pretrained("openai/whisper-tiny").eval()


def load_backend() -> Any:
    requested = os.environ.get("THALAMUS_ENCODER_BACKEND", "fallback").lower()
    if requested in {"hf", "huggingface", "hf-fp32", "hf-int8"}:
        try:
            return HuggingFaceBackend()
        except Exception as exc:  # pragma: no cover - depends on optional deps
            message = {
                "server_event": "hf_backend_unavailable",
                "error": str(exc),
                "hf_home": str(resolve_hf_home()),
            }
            print(json.dumps(message), file=sys.stderr, flush=True)
            raise SystemExit(2) from exc
    return DeterministicBackend()


def resolve_hf_home() -> Path:
    existing = os.environ.get("HF_HOME")
    if existing:
        return Path(existing)

    if os.name == "nt" and Path("D:/").exists():
        hf_home = Path("D:/hf-cache/main")
    else:
        hf_home = Path.home() / ".cache" / "huggingface"

    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("HF_HUB_CACHE", str(hf_home / "hub"))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(hf_home / "transformers"))
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(hf_home / "sentence-transformers"))
    return hf_home


def parse_ppm_metadata(payload: bytes) -> ImageMetadata | None:
    if not payload.startswith(b"P6\n"):
        return None

    header_end = payload.find(b"\n255\n")
    if header_end < 0:
        return None

    header = payload[:header_end].decode("ascii", "replace")
    color_match = re.search(r"color=([a-z]+)", header)
    shape_match = re.search(r"shape=([a-z]+)", header)
    size_match = re.search(r"\n(\d+) (\d+)(?:\n|$)", header)
    if color_match is None or shape_match is None or size_match is None:
        return None

    return ImageMetadata(
        color=color_match.group(1),
        shape=shape_match.group(1),
        width=int(size_match.group(1)),
        height=int(size_match.group(2)),
    )


def dominant_color(payload: bytes) -> str:
    digest = stable_u32(payload)
    return COLORS[digest % len(COLORS)]


def stable_u32(payload: bytes) -> int:
    return int.from_bytes(hashlib.sha256(payload).digest()[:4], "big")


def normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


def pooled_tensor(features: Any) -> Any:
    tensor = getattr(features, "pooler_output", None)
    if tensor is None:
        tensor = getattr(features, "last_hidden_state", None)
    if tensor is None:
        tensor = features[0] if isinstance(features, (tuple, list)) else features
    if getattr(tensor, "ndim", 0) == 3:
        tensor = tensor.mean(dim=1)
    return tensor


def handle_request(backend: Any, request: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    request_id = request.get("id")

    try:
        op = request.get("op", "encode")
        payload = base64.b64decode(request.get("payload_base64", ""))
        text = request.get("text")

        if op == "caption":
            caption = backend.caption(payload)
            return {
                "id": request_id,
                "ok": True,
                "backend": backend.name,
                "caption": caption,
                "latency_ms": (time.perf_counter() - started) * 1000,
            }

        vector = backend.encode(str(request.get("modality")), payload, text if isinstance(text, str) else None)
        return {
            "id": request_id,
            "ok": True,
            "backend": backend.name,
            "vector": vector,
            "latency_ms": (time.perf_counter() - started) * 1000,
        }
    except Exception as exc:
        return {
            "id": request_id,
            "ok": False,
            "backend": getattr(backend, "name", "unknown"),
            "error": str(exc),
            "latency_ms": (time.perf_counter() - started) * 1000,
        }


def main() -> int:
    hf_home = resolve_hf_home()
    backend = load_backend()
    print(
        json.dumps({"server_event": "ready", "backend": backend.name, "hf_home": str(hf_home)}),
        file=sys.stderr,
        flush=True,
    )

    for line in sys.stdin:
        if not line.strip():
            continue
        response = handle_request(backend, json.loads(line))
        print(json.dumps(response), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
