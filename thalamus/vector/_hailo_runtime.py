"""Shared helpers for Thalamus encoder subprocesses."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HAILO_APPS_DIR = Path(os.environ.get("HAILO_APPS_DIR", Path.home() / "projects-alcyone" / "hailo-apps"))
HAILO10H_MODEL_DIR = Path("/usr/local/hailo/resources/models/hailo10h")


def configure_paths() -> None:
    for candidate in (PROJECT_ROOT, HAILO_APPS_DIR):
        text = str(candidate)
        if candidate.exists() and text not in sys.path:
            sys.path.insert(0, text)


def l2_normalize(vec: np.ndarray) -> np.ndarray:
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(arr))
    if not np.isfinite(norm) or norm == 0:
        return np.zeros_like(arr, dtype=np.float32)
    return (arr / norm).astype(np.float32)


def emit_ok(vector: np.ndarray, *, model: str, latency_ms: int, extra: dict[str, Any] | None = None) -> None:
    arr = np.asarray(vector, dtype=np.float32).reshape(-1)
    payload: dict[str, Any] = {
        "ok": True,
        "vector": arr.tolist(),
        "dim": int(arr.shape[0]),
        "model": model,
        "degraded": False,
        "latency_ms": latency_ms,
    }
    if extra:
        payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False))


def emit_error(error: BaseException | str, *, model: str | None = None, started: float | None = None) -> None:
    payload = {
        "ok": False,
        "vector": None,
        "dim": 0,
        "model": model,
        "degraded": True,
        "error": str(error),
        "latency_ms": int((time.time() - started) * 1000) if started else None,
    }
    print(json.dumps(payload, ensure_ascii=False))


def run_hailo_single(
    hef_path: str,
    input_buffer: np.ndarray,
    *,
    input_type: str = "FLOAT32",
    output_type: str = "FLOAT32",
    timeout_ms: int = 10000,
) -> dict[str, np.ndarray]:
    configure_paths()
    from hailo_platform import FormatType, HailoSchedulingAlgorithm, VDevice

    params = VDevice.create_params()
    params.group_id = "SHARED"
    try:
        params.scheduling_algorithm = HailoSchedulingAlgorithm.ROUND_ROBIN
    except Exception:
        pass

    with VDevice(params) as vdevice:
        infer_model = vdevice.create_infer_model(str(hef_path))
        infer_model.input().set_format_type(getattr(FormatType, input_type))
        for output in infer_model.outputs:
            infer_model.output(output.name).set_format_type(getattr(FormatType, output_type))

        with infer_model.configure() as configured:
            output_buffers = {
                output.name: np.empty(infer_model.output(output.name).shape, dtype=np.float32)
                for output in infer_model.outputs
            }
            bindings = configured.create_bindings(output_buffers=output_buffers)
            bindings.input().set_buffer(np.ascontiguousarray(input_buffer))
            configured.run([bindings], timeout_ms)
            return {name: bindings.output(name).get_buffer().copy() for name in output_buffers}


def first_output(outputs: dict[str, np.ndarray]) -> np.ndarray:
    if not outputs:
        raise RuntimeError("HEF returned no outputs")
    return next(iter(outputs.values()))

