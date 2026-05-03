#!/usr/bin/env python3
"""PRD-B: probe Whisper-encoder determinism.

Re-embed jfk.wav 5 times back-to-back via daemon, log every intermediate stage:
- Hash of normalized audio bytes after improve_audio
- Hash of each chunk after preprocess_audio
- Per-chunk vector
- Final mean vector

Identifies which stage introduces variance.
"""
from __future__ import annotations
import hashlib, json, math, os, socket, sys, time
import numpy as np
from pathlib import Path

SOCK = "/home/msbel/.openclaw/thalamus/ipc.sock"
AUDIO = sys.argv[1] if len(sys.argv) > 1 else "/home/msbel/projects-alcyone/whisper.cpp/samples/jfk.wav"


def daemon(method, params, t=180):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(t)
    s.connect(SOCK)
    s.sendall((json.dumps({"method": method, "params": params, "id": 1}) + "\n").encode())
    chunks = []
    while True:
        c = s.recv(4096)
        if not c: break
        chunks.append(c)
        if b"\n" in c: break
    s.close()
    return json.loads(b"".join(chunks).decode().strip())


def cos(a, b):
    a = np.asarray(a, dtype=np.float64); b = np.asarray(b, dtype=np.float64)
    if a.shape != b.shape: return None
    na = float(np.linalg.norm(a)); nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0: return None
    return float(np.dot(a, b) / (na * nb))


# Stage 1: probe via daemon (black-box) — get final vector 5x
print("=== STAGE 1: 5x daemon end-to-end ===")
vecs = []
for i in range(5):
    t0 = time.time()
    r = daemon("embed_audio_whisper", {"audio_path": AUDIO}, t=180)
    if not r.get("ok"):
        print(f"  call {i}: ERR {r.get('error')}")
        continue
    v = r["vector"]
    vecs.append(v)
    print(f"  call {i}: dim={len(v)} encode_ms={r.get('encode_ms')} chunks={r.get('chunks')} "
          f"first5={[f'{x:.6f}' for x in v[:5]]}")

# Cosine matrix between calls
print("\n=== Cosine matrix (call_i, call_j) ===")
print("        ", "  ".join(f"call_{j}" for j in range(len(vecs))))
for i, vi in enumerate(vecs):
    row = [f"call_{i}"]
    for j, vj in enumerate(vecs):
        row.append(f"{cos(vi, vj):.6f}")
    print("  " + "  ".join(row))

# Stage 2: bypass daemon, run preprocessing in-process, hash intermediate stages
print("\n=== STAGE 2: in-process preprocessing trace ===")
sys.path.insert(0, "/home/msbel/projects-alcyone/openclaw-thalamus")
from thalamus.vector._hailo_runtime import configure_paths
configure_paths()
from hailo_apps.python.standalone_apps.speech_recognition.audio_utils import (
    improve_audio, load_audio, preprocess_audio,
)


def hash_arr(a):
    return hashlib.sha256(np.asarray(a, dtype=np.float32).tobytes()).hexdigest()[:16]


for i in range(3):
    audio_arr, sr = improve_audio(load_audio(AUDIO))
    chunks = preprocess_audio(audio_arr, chunk_length=10, max_duration=600)
    chunk_hashes = [hash_arr(c) for c in chunks]
    audio_hash = hash_arr(audio_arr)
    print(f"  iter {i}: audio_sha={audio_hash} sr={sr} n_chunks={len(chunks)} "
          f"chunk_hashes={chunk_hashes}")

print("\n=== Verdict ===")
if len(set(hash_arr(np.asarray(v, dtype=np.float32)) for v in vecs)) == 1:
    print("  DETERMINISTIC: all daemon calls produced identical vector")
else:
    # if preprocessing hashes are stable but final vectors differ, HEF inference has noise
    print("  NON-DETERMINISTIC vectors observed across calls.")
    print("  → If preprocessing hashes (Stage 2) match across iters but vectors differ,")
    print("    variance source is in Hailo HEF inference (quantization noise, scheduling, or thermal).")
    print("  → If preprocessing hashes vary, variance is in audio_utils preprocessing (RNG, padding, etc.).")
