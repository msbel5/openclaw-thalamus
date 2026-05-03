"""Dimension adapters for Thalamus vector-aware agent handoff.

v0.2 ships with deterministic Johnson-Lindenstrauss style random
projection fallback. Trained adapters can be dropped into
~/.openclaw/thalamus/.cache/normalizers/ later without changing agent
prompts or MCP tool contracts.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Iterable, Tuple

import numpy as np


HOME = Path.home()
CACHE_DIR = Path(os.environ.get("THALAMUS_NORMALIZER_CACHE", HOME / ".openclaw" / "thalamus" / ".cache" / "normalizers"))


def _as_float32(vec: Iterable[float]) -> np.ndarray:
    arr = np.asarray(list(vec), dtype=np.float32)
    if arr.ndim != 1:
        arr = arr.reshape(-1)
    return arr


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if not np.isfinite(norm) or norm == 0:
        return np.zeros_like(vec, dtype=np.float32)
    return (vec / norm).astype(np.float32)


def _seed(source_dim: int, target_dim: int, source_namespace: str) -> int:
    digest = hashlib.sha256(f"{source_namespace}:{source_dim}->{target_dim}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little", signed=False) % (2**32)


def _projection(source_dim: int, target_dim: int, source_namespace: str) -> np.ndarray:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{source_namespace.replace('/', '_').replace('.', '_')}_{source_dim}_to_{target_dim}.npy"
    file = CACHE_DIR / name
    if file.exists():
        matrix = np.load(file)
        if matrix.shape == (target_dim, source_dim):
            return matrix.astype(np.float32)
    rng = np.random.default_rng(_seed(source_dim, target_dim, source_namespace))
    matrix = rng.normal(0.0, 1.0 / np.sqrt(max(1, target_dim)), size=(target_dim, source_dim)).astype(np.float32)
    np.save(file, matrix)
    return matrix


def normalize_to_512(vec: Iterable[float], source_dim: int | None = None, source_namespace: str = "unknown") -> np.ndarray:
    """Return a 512d L2-normalized float32 vector.

    - 512d CLIP vectors pass through identity.
    - 384d MiniLM and other dims use deterministic projection fallback.
    - Trained .npy weights can replace fallback matrices in CACHE_DIR.
    """

    arr = _as_float32(vec)
    if source_dim is not None and int(source_dim) != int(arr.shape[0]):
        raise ValueError(f"source_dim={source_dim} does not match vector shape={arr.shape[0]}")
    if arr.shape[0] == 512:
        return _l2(arr)
    matrix = _projection(arr.shape[0], 512, source_namespace)
    return _l2(matrix @ _l2(arr))


def normalize_to_dim(vec: Iterable[float], target_dim: int, source_namespace: str = "unknown") -> np.ndarray:
    arr = _as_float32(vec)
    if arr.shape[0] == int(target_dim):
        return _l2(arr)
    matrix = _projection(arr.shape[0], int(target_dim), source_namespace)
    return _l2(matrix @ _l2(arr))


def normalize_pairwise(
    vec_a: Iterable[float],
    vec_b: Iterable[float],
    source_a: str = "a",
    source_b: str = "b",
) -> Tuple[np.ndarray, np.ndarray, int]:
    a = _as_float32(vec_a)
    b = _as_float32(vec_b)
    if a.shape[0] == b.shape[0]:
        return _l2(a), _l2(b), int(a.shape[0])
    return normalize_to_512(a, source_namespace=source_a), normalize_to_512(b, source_namespace=source_b), 512


def cosine(vec_a: Iterable[float], vec_b: Iterable[float]) -> float:
    a, b, _ = normalize_pairwise(vec_a, vec_b)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return float("nan")
    return float(np.dot(a, b) / denom)


if __name__ == "__main__":
    v = np.random.default_rng(42).random(384).astype(np.float32)
    print(normalize_to_512(v, 384, "minilm").shape)
