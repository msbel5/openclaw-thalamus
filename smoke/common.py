from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PY = os.environ.get("HAILO_APPS_PYTHON", "/home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python")


def run_encoder(module: str, arg: str) -> dict:
    proc = subprocess.run(
        [PY, "-m", module, arg],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as exc:
        raise AssertionError(f"{module} returned no JSON: {exc}; stderr={proc.stderr[-500:]}") from exc
    if proc.returncode != 0 or not payload.get("ok"):
        raise AssertionError(f"{module} failed: {payload.get('error') or proc.stderr[-500:]}")
    if payload.get("degraded"):
        raise AssertionError(f"{module} degraded: {payload.get('error')}")
    return payload


def vector(module: str, arg: str) -> np.ndarray:
    payload = run_encoder(module, arg)
    return np.array(payload["vector"], dtype=np.float32)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def pass_line(name: str, **metrics) -> None:
    print(json.dumps({"test": name, "ok": True, **metrics}, ensure_ascii=False))

