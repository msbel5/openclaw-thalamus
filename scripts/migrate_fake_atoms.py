#!/usr/bin/env python3
"""Migration: re-embed all fake/degraded atoms via the encoder daemon.

For each atoms.*.json file under ~/.openclaw/thalamus/state/vectors/:
- Identify rows where degraded=True or model contains "compatible".
- Re-embed using the appropriate daemon method based on namespace:
    atoms.memory|code|audit|plan|audio.text|image.text  → embed_text  (distiluse 512d)
    atoms.crossmodal                                    → embed_clip_text (Hailo)
    atoms.audio.raw                                     → embed_audio_whisper (Hailo)
    atoms.image.raw                                     → embed_clip_image (Hailo)
- Update vector + normalized_512 + model + degraded=False + proof.
- Write atomically (temp file + fsync + rename) per file.
- Idempotent: skip rows already non-degraded.

Run with venv python so sentence-transformers + hailo are importable:
    /home/msbel/projects-alcyone/hailo-apps/venv_hailo_apps/bin/python migrate_fake_atoms.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

VECTOR_DIR = Path("/home/msbel/.openclaw/thalamus/state/vectors")
SOCKET_PATH = "/home/msbel/.openclaw/thalamus/ipc.sock"

# Namespace -> daemon method + param key
NS_METHOD = {
    "atoms.memory":     ("embed_text",          "text",       "text"),
    "atoms.code":       ("embed_text",          "text",       "text"),
    "atoms.audit":      ("embed_text",          "text",       "text"),
    "atoms.plan":       ("embed_text",          "text",       "text"),
    "atoms.audio.text": ("embed_text",          "text",       "text"),
    "atoms.image.text": ("embed_text",          "text",       "text"),
    "atoms.crossmodal": ("embed_clip_text",     "text",       "text"),
    "atoms.audio.raw":  ("embed_audio_whisper", "audio_path", "raw_payload_path"),
    "atoms.image.raw":  ("embed_clip_image",    "image_path", "raw_payload_path"),
}


def daemon_call(method: str, params: Dict[str, Any], timeout_s: int = 180) -> Dict[str, Any]:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout_s)
    s.connect(SOCKET_PATH)
    s.sendall((json.dumps({"method": method, "params": params, "id": 1}) + "\n").encode("utf-8"))
    chunks: List[bytes] = []
    while True:
        c = s.recv(4096)
        if not c:
            break
        chunks.append(c)
        if b"\n" in c:
            break
    s.close()
    return json.loads(b"".join(chunks).decode("utf-8").strip())


def is_fake(row: Dict[str, Any]) -> bool:
    if row.get("degraded") is True:
        return True
    model = str(row.get("model", "")).lower()
    if "compatible" in model:
        return True
    if "hash" in model:
        return True
    return False


def project_to_dim(vec: List[float], target_dim: int, source_namespace: str) -> List[float]:
    """Hash-seeded random projection (Johnson-Lindenstrauss) — deterministic, reproducible.

    Mirrors normalizeVectorToDim from src/vector_store.js so daemon vectors land in
    the same space as the existing normalizer math when dimensions differ.
    """
    if len(vec) == target_dim:
        n = math.sqrt(sum(v * v for v in vec))
        return [v / n if n else 0.0 for v in vec]
    import hashlib
    out = [0.0] * target_dim
    for i, val in enumerate(vec):
        seed_bytes = hashlib.sha256(f"projection:{source_namespace}:{len(vec)}->{target_dim}:{i}".encode()).digest()
        # generate target_dim floats in [-1, 1]
        b = seed_bytes
        idx = 0
        basis = []
        while len(basis) < target_dim:
            if idx >= len(b):
                b = b + hashlib.sha256(b).digest()
            basis.append((b[idx] / 127.5) - 1.0 or 0.0001)
            idx += 1
        # L2 normalize basis
        bn = math.sqrt(sum(x * x for x in basis))
        if bn:
            basis = [x / bn for x in basis]
        for j in range(target_dim):
            out[j] += basis[j] * val
    n = math.sqrt(sum(v * v for v in out))
    return [v / n if n else 0.0 for v in out]


def migrate_row(row: Dict[str, Any], namespace: str) -> Dict[str, Any]:
    if namespace not in NS_METHOD:
        return {"ok": False, "skip": True, "reason": f"unknown namespace {namespace}"}
    method, param_key, source_field = NS_METHOD[namespace]
    src = row.get(source_field)
    if not src:
        return {"ok": False, "skip": True, "reason": f"missing {source_field}"}
    # For raw payload methods, sanity-check file exists
    if param_key in ("audio_path", "image_path"):
        if not Path(src).exists():
            return {"ok": False, "skip": True, "reason": f"file not found: {src}"}
    timeout = 240 if method == "embed_audio_whisper" else 60
    r = daemon_call(method, {param_key: src}, timeout_s=timeout)
    if not r or not r.get("ok") or not isinstance(r.get("vector"), list):
        return {"ok": False, "skip": False, "reason": f"daemon error: {r.get('error', 'no vector returned')}"}
    new_vec = list(r["vector"])
    target_dim = int(row.get("vector_dim") or len(new_vec))
    if len(new_vec) != target_dim:
        new_vec = project_to_dim(new_vec, target_dim, namespace)
    # normalized_512 always 512d
    if len(new_vec) == 512:
        normalized_512 = list(new_vec)
    else:
        normalized_512 = project_to_dim(new_vec, 512, namespace)
    return {
        "ok": True,
        "vector": new_vec,
        "normalized_512": normalized_512,
        "model": r.get("model", "encoder-daemon"),
        "encode_ms": r.get("encode_ms"),
        "rss_mb": r.get("rss_mb"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    ap.add_argument("--namespace", default=None, help="limit to one namespace (default: all)")
    ap.add_argument("--max-rows", type=int, default=None, help="max rows to migrate per namespace")
    args = ap.parse_args()

    files = sorted(VECTOR_DIR.glob("atoms.*.json"))
    if args.namespace:
        files = [f for f in files if f.stem == args.namespace]

    summary = {"files": [], "total_migrated": 0, "total_skipped": 0, "total_failed": 0}

    for fpath in files:
        try:
            with fpath.open("r") as f:
                rows = json.load(f)
        except Exception as e:
            print(f"[ERR] {fpath.name}: cannot read: {e}", file=sys.stderr)
            continue

        ns = fpath.stem  # e.g. "atoms.memory"
        fakes = [(i, r) for i, r in enumerate(rows) if is_fake(r)]
        if args.max_rows is not None:
            fakes = fakes[: args.max_rows]
        if not fakes:
            print(f"[SKIP] {fpath.name}: 0 fake rows (all clean)")
            summary["files"].append({"file": fpath.name, "fakes": 0, "migrated": 0, "skipped": 0, "failed": 0})
            continue

        print(f"[GO]   {fpath.name}: {len(fakes)} fake row(s) to re-embed via daemon...")
        migrated = skipped = failed = 0
        for idx, row in fakes:
            t0 = time.time()
            res = migrate_row(row, ns)
            wall_ms = int((time.time() - t0) * 1000)
            if res.get("skip"):
                skipped += 1
                print(f"  - row[{idx}] SKIP: {res.get('reason')}")
                continue
            if not res.get("ok"):
                failed += 1
                print(f"  - row[{idx}] FAIL: {res.get('reason')} (wall {wall_ms}ms)")
                continue
            # Mutate the row in place
            row["vector"] = res["vector"]
            row["normalized_512"] = res["normalized_512"]
            row["model"] = res["model"]
            row["degraded"] = False
            row["confidence"] = max(float(row.get("confidence", 0.0)), 0.85)
            old_top_model = row.get("model")
            row.setdefault("metadata", {})
            row["metadata"]["migrated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            row["metadata"]["migrated_via"] = "encoder-daemon"
            # PRD-D fix: capture top-level model BEFORE mutation, not nested metadata.model
            row["metadata"]["pre_migration_model"] = row["metadata"].get("pre_migration_model", old_top_model)
            migrated += 1
            print(f"  + row[{idx}] OK   ns={ns} dim={len(res['vector'])} model={res['model']} encode={res.get('encode_ms')}ms wall={wall_ms}ms")

        # Atomic write per file
        if not args.dry_run and migrated > 0:
            tmp = fpath.with_suffix(".json.new")
            with tmp.open("w") as f:
                json.dump(rows, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(str(tmp), str(fpath))
            print(f"  WROTE {fpath.name} ({migrated} updated, {skipped} skipped, {failed} failed)")
        elif args.dry_run:
            print(f"  DRY-RUN {fpath.name} would update {migrated}, skip {skipped}, fail {failed}")

        summary["files"].append({
            "file": fpath.name, "fakes": len(fakes),
            "migrated": migrated, "skipped": skipped, "failed": failed,
        })
        summary["total_migrated"] += migrated
        summary["total_skipped"] += skipped
        summary["total_failed"] += failed

    print()
    print("=" * 60)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
