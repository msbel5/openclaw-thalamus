#!/usr/bin/env python3
"""Thalamus Encoder IPC Server (v1 — text only).

Listens on UNIX socket, serves JSON-RPC embed requests. Lazy-loads
distiluse-base-multilingual-cased-v2 on first text request, keeps it warm.
Eliminates ~33sec cold start that subprocess pattern incurs per call.

v1 SCOPE:
  - embed_text: distiluse 512d, CPU
  - health: status + RSS + loaded models + uptime
  - unload: free a loaded model (memory pressure handling)

DEFERRED TO v0.4:
  - embed_audio/embed_image/embed_clip_text (Hailo HEF integration)
  - mlock pinning
  - LRU eviction policy
  - Persistent process pool

Socket path: ~/.openclaw/thalamus/ipc.sock (perms 0600)
JSON-RPC 2.0 framing: NDJSON (one JSON object per line, both directions).

Usage:
  python3 encoder_server.py             # foreground for systemd Type=simple
  python3 encoder_server.py --health    # one-shot health probe via existing socket
  python3 encoder_server.py --bench     # quick warm benchmark
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import resource
import signal
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

HOME = Path(os.path.expanduser("~"))
SOCKET_PATH = Path(os.environ.get(
    "THALAMUS_ENCODER_SOCKET",
    str(HOME / ".openclaw" / "thalamus" / "ipc.sock"),
))
LOG_PATH = HOME / ".openclaw" / "thalamus" / "state" / "encoder_server.log"

START_TS = time.time()
LOADED_MODELS: Dict[str, Dict[str, Any]] = {}
DISTILUSE_MODEL_NAME = "distiluse-base-multilingual-cased-v2"
CLIP_TEXT_NAME = "hailo-clip-vit-b-32-text"
CLIP_IMAGE_NAME = "hailo-clip-vit-b-32-image"
WHISPER_AUDIO_NAME = "hailo-whisper-base-encoder-10s"
QWEN3_Q4_NAME = "qwen3-embedding-0.6b-q4_0"
QWEN3_Q4K_NAME = "qwen3-embedding-0.6b-q4_k_m"
GTE_MODEL_NAME = "Alibaba-NLP/gte-multilingual-base"
MODEL_DIR = HOME / ".openclaw" / "thalamus" / "models"
QWEN3_MODELS = {
    "q4_0": MODEL_DIR / "qwen3-embedding-0.6b-q4_0.gguf",
    "q4_k_m": MODEL_DIR / "qwen3-embedding-0.6b-q4_k_m.gguf",
}


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    line = f"[{ts}] {msg}\n"
    sys.stderr.write(line)
    sys.stderr.flush()
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(line)
    except Exception:
        pass


def get_rss_mb() -> float:
    """Return RSS in MB (Linux: /proc/self/status VmRSS)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    kb = int(line.split()[1])
                    return kb / 1024.0
    except Exception:
        pass
    return float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) / 1024.0


def load_distiluse() -> Dict[str, Any]:
    """Lazy-load sentence-transformers distiluse model. Cached after first call."""
    if DISTILUSE_MODEL_NAME in LOADED_MODELS:
        return LOADED_MODELS[DISTILUSE_MODEL_NAME]
    log(f"loading {DISTILUSE_MODEL_NAME} (cold start expected ~30s)...")
    t0 = time.time()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(DISTILUSE_MODEL_NAME)
    load_ms = (time.time() - t0) * 1000
    LOADED_MODELS[DISTILUSE_MODEL_NAME] = {
        "kind": "text",
        "loaded_at": time.time(),
        "load_ms": load_ms,
        "dim": 512,
        "instance": model,
    }
    log(f"loaded {DISTILUSE_MODEL_NAME} in {load_ms:.0f}ms, RSS={get_rss_mb():.0f}MB")
    return LOADED_MODELS[DISTILUSE_MODEL_NAME]



def _normalize_list(vec):
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(arr))
    if not np.isfinite(norm) or norm == 0:
        return arr.tolist()
    return (arr / norm).astype(np.float32).tolist()

def load_qwen3(variant: str | None = None) -> Dict[str, Any]:
    variant = (variant or os.environ.get("THALAMUS_QWEN3_VARIANT") or "q4_0").lower()
    if variant == "q3_k_m":
        variant = "q4_k_m"
    model_path = QWEN3_MODELS.get(variant) or QWEN3_MODELS["q4_0"]
    name = QWEN3_Q4K_NAME if variant == "q4_k_m" else QWEN3_Q4_NAME
    if name in LOADED_MODELS:
        return LOADED_MODELS[name]
    if not model_path.exists():
        raise FileNotFoundError(f"qwen3 gguf missing: {model_path}")
    log(f"loading {name} from {model_path}...")
    t0 = time.time()
    from llama_cpp import Llama
    model = Llama(model_path=str(model_path), embedding=True, n_ctx=int(os.environ.get("THALAMUS_QWEN3_N_CTX", "512")), n_threads=int(os.environ.get("THALAMUS_QWEN3_THREADS", "4")), verbose=False)
    load_ms = (time.time() - t0) * 1000
    LOADED_MODELS[name] = {"kind": "text-qwen3", "loaded_at": time.time(), "load_ms": load_ms, "dim": 1024, "instance": model, "variant": variant, "path": str(model_path)}
    log(f"loaded {name} in {load_ms:.0f}ms, RSS={get_rss_mb():.0f}MB")
    return LOADED_MODELS[name]

def handle_embed_text_qwen3(params: Dict[str, Any]) -> Dict[str, Any]:
    text = str(params.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "embed_text_qwen3 requires non-empty text"}
    variant = params.get("variant") or os.environ.get("THALAMUS_QWEN3_VARIANT") or "q4_0"
    t0 = time.time()
    try:
        entry = load_qwen3(str(variant))
        out = entry["instance"].create_embedding(text)
        vlist = _normalize_list(out["data"][0]["embedding"])
        return {"ok": True, "vector_dim": len(vlist), "vector": vlist, "model": QWEN3_Q4K_NAME if entry.get("variant") == "q4_k_m" else QWEN3_Q4_NAME, "variant": entry.get("variant"), "degraded": False, "encode_ms": round((time.time() - t0) * 1000, 2), "rss_mb": round(get_rss_mb(), 1), "source": "encoder-daemon-llama-cpp"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "degraded": True, "encode_ms": round((time.time() - t0) * 1000, 2)}

def load_gte() -> Dict[str, Any]:
    if GTE_MODEL_NAME in LOADED_MODELS:
        return LOADED_MODELS[GTE_MODEL_NAME]
    log(f"loading {GTE_MODEL_NAME}...")
    t0 = time.time()
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(GTE_MODEL_NAME, trust_remote_code=True)
    load_ms = (time.time() - t0) * 1000
    LOADED_MODELS[GTE_MODEL_NAME] = {"kind": "text-gte", "loaded_at": time.time(), "load_ms": load_ms, "dim": 768, "instance": model}
    log(f"loaded {GTE_MODEL_NAME} in {load_ms:.0f}ms, RSS={get_rss_mb():.0f}MB")
    return LOADED_MODELS[GTE_MODEL_NAME]

def handle_embed_text_gte(params: Dict[str, Any]) -> Dict[str, Any]:
    text = str(params.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "embed_text_gte requires non-empty text"}
    t0 = time.time()
    try:
        entry = load_gte()
        vec = entry["instance"].encode(text, convert_to_numpy=True, normalize_embeddings=True)
        vlist = np.asarray(vec, dtype=np.float32).reshape(-1).tolist()
        return {"ok": True, "vector_dim": len(vlist), "vector": vlist, "model": GTE_MODEL_NAME, "degraded": False, "encode_ms": round((time.time()-t0)*1000, 2), "rss_mb": round(get_rss_mb(), 1), "source": "encoder-daemon-sentence-transformers"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "degraded": True, "encode_ms": round((time.time()-t0)*1000, 2)}

def handle_embed_text(params: Dict[str, Any]) -> Dict[str, Any]:
    text = str(params.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "embed_text requires non-empty 'text'"}
    t0 = time.time()
    entry = load_distiluse()
    model = entry["instance"]
    vec = model.encode(text, convert_to_numpy=True, normalize_embeddings=False)
    encode_ms = (time.time() - t0) * 1000
    vlist = vec.tolist()
    return {
        "ok": True,
        "vector_dim": len(vlist),
        "vector": vlist,
        "model": DISTILUSE_MODEL_NAME,
        "degraded": False,
        "encode_ms": round(encode_ms, 2),
        "rss_mb": round(get_rss_mb(), 1),
        "source": "encoder-daemon",
    }


# ---------------------------------------------------------------------------
# Hailo HEF encoders (CLIP-text, CLIP-image, Whisper-encoder)
#
# Each call still opens a fresh VDevice (existing pattern in
# thalamus.vector._hailo_runtime). The win vs subprocess is ~1-2s saved
# Python interpreter startup per call. VDevice/HEF cold-load happens per call.
# True warm caching of VDevice would conflict with hailo-ollama on /dev/hailo0
# and is deferred to v0.4 with a Hailo scheduling layer.
# ---------------------------------------------------------------------------

import numpy as np  # heavy but already loaded by sentence-transformers

def _ensure_runtime_module():
    """Add ~/projects-alcyone/openclaw-thalamus to sys.path on first call."""
    repo = os.environ.get("THALAMUS_REPO", str(HOME / "projects-alcyone" / "openclaw-thalamus"))
    if repo not in sys.path:
        sys.path.insert(0, repo)
    try:
        from thalamus.vector import _hailo_runtime  # noqa: F401
    except ImportError as e:
        raise RuntimeError(f"failed to import thalamus._hailo_runtime: {e}")


def handle_embed_clip_text(params: Dict[str, Any]) -> Dict[str, Any]:
    text = str(params.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "embed_clip_text requires non-empty 'text'"}
    t0 = time.time()
    try:
        _ensure_runtime_module()
        from thalamus.vector._hailo_runtime import HAILO10H_MODEL_DIR, configure_paths, l2_normalize
        configure_paths()
        from hailo_apps.python.pipeline_apps.clip.clip_text_utils import (
            DEFAULT_TEXT_PROJECTION_PATH, run_text_encoder_inference,
        )
        model_path = HAILO10H_MODEL_DIR / "clip_vit_b_32_text_encoder.hef"
        vec = run_text_encoder_inference(
            text, str(model_path),
            text_projection_path=DEFAULT_TEXT_PROJECTION_PATH,
            timeout_ms=10000,
        )[0]
        vec = l2_normalize(vec)
        encode_ms = (time.time() - t0) * 1000
        # Record load only first time (this isn't a true cache; it's a marker)
        if CLIP_TEXT_NAME not in LOADED_MODELS:
            LOADED_MODELS[CLIP_TEXT_NAME] = {
                "kind": "text-clip", "loaded_at": time.time(),
                "load_ms": encode_ms, "dim": 512, "instance": None,
            }
        return {
            "ok": True, "vector_dim": int(vec.shape[0]), "vector": vec.tolist(),
            "model": CLIP_TEXT_NAME, "degraded": False,
            "encode_ms": round(encode_ms, 2), "rss_mb": round(get_rss_mb(), 1),
            "source": "encoder-daemon-hailo",
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "degraded": True,
                "encode_ms": round((time.time() - t0) * 1000, 2)}


def handle_embed_clip_image(params: Dict[str, Any]) -> Dict[str, Any]:
    image_path = str(params.get("image_path", "")).strip()
    if not image_path or not Path(image_path).exists():
        return {"ok": False, "error": f"image_path missing or not found: {image_path!r}"}
    t0 = time.time()
    try:
        _ensure_runtime_module()
        from thalamus.vector._hailo_runtime import (
            HAILO10H_MODEL_DIR, configure_paths, first_output, l2_normalize, run_hailo_single,
        )
        from PIL import Image, ImageOps
        configure_paths()
        model_path = HAILO10H_MODEL_DIR / "clip_vit_b_32_image_encoder.hef"
        img = Image.open(image_path).convert("RGB")
        img = ImageOps.fit(img, (224, 224), method=Image.Resampling.BICUBIC, centering=(0.5, 0.5))
        arr = np.ascontiguousarray(np.asarray(img, dtype=np.uint8)[None, ...].copy())
        outputs = run_hailo_single(str(model_path), arr, input_type="UINT8", output_type="FLOAT32")
        vec = l2_normalize(first_output(outputs))
        encode_ms = (time.time() - t0) * 1000
        if CLIP_IMAGE_NAME not in LOADED_MODELS:
            LOADED_MODELS[CLIP_IMAGE_NAME] = {
                "kind": "image-clip", "loaded_at": time.time(),
                "load_ms": encode_ms, "dim": 512, "instance": None,
            }
        return {
            "ok": True, "vector_dim": int(vec.shape[0]), "vector": vec.tolist(),
            "model": CLIP_IMAGE_NAME, "degraded": False,
            "encode_ms": round(encode_ms, 2), "rss_mb": round(get_rss_mb(), 1),
            "source": "encoder-daemon-hailo",
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "degraded": True,
                "encode_ms": round((time.time() - t0) * 1000, 2)}


def handle_embed_audio_whisper(params: Dict[str, Any]) -> Dict[str, Any]:
    audio_path = str(params.get("audio_path", "")).strip()
    if not audio_path or not Path(audio_path).exists():
        return {"ok": False, "error": f"audio_path missing or not found: {audio_path!r}"}
    t0 = time.time()
    try:
        _ensure_runtime_module()
        from thalamus.vector._hailo_runtime import (
            HAILO10H_MODEL_DIR, configure_paths, first_output, l2_normalize, run_hailo_single,
        )
        configure_paths()
        from hailo_apps.python.standalone_apps.speech_recognition.audio_utils import (
            improve_audio, load_audio, preprocess_audio,
        )
        model_path = HAILO10H_MODEL_DIR / "base-whisper-encoder-10s.hef"
        audio, _ = improve_audio(load_audio(audio_path))
        chunks = preprocess_audio(audio, chunk_length=10, max_duration=600)
        if not chunks:
            raise RuntimeError("audio produced no 10s chunks")
        vectors = []
        for chunk in chunks:
            outputs = run_hailo_single(str(model_path), chunk.astype(np.float32),
                                       input_type="FLOAT32", output_type="FLOAT32")
            squeezed = np.asarray(first_output(outputs), dtype=np.float32).squeeze()
            if squeezed.ndim > 1:
                if squeezed.shape[-1] == 512:
                    squeezed = squeezed.mean(axis=tuple(range(squeezed.ndim - 1)))
                else:
                    squeezed = squeezed.flatten()[:512]
            vectors.append(squeezed)
        vec = l2_normalize(np.stack(vectors, axis=0).mean(axis=0))
        encode_ms = (time.time() - t0) * 1000
        if WHISPER_AUDIO_NAME not in LOADED_MODELS:
            LOADED_MODELS[WHISPER_AUDIO_NAME] = {
                "kind": "audio-whisper", "loaded_at": time.time(),
                "load_ms": encode_ms, "dim": 512, "instance": None,
            }
        return {
            "ok": True, "vector_dim": int(vec.shape[0]), "vector": vec.tolist(),
            "model": WHISPER_AUDIO_NAME, "degraded": False,
            "encode_ms": round(encode_ms, 2), "rss_mb": round(get_rss_mb(), 1),
            "source": "encoder-daemon-hailo", "chunks": len(chunks),
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "degraded": True,
                "encode_ms": round((time.time() - t0) * 1000, 2)}



# ---------------------------------------------------------------------------
# Concept codes (FAISS PQ) — experimental, default OFF.
# ---------------------------------------------------------------------------
CODEBOOK_PATH = HOME / ".openclaw" / "thalamus" / "state" / "codebook.faiss"
CODEBOOK_META_PATH = HOME / ".openclaw" / "thalamus" / "state" / "codebook_metadata.json"
OPQ_ROTATION_PATH = HOME / ".openclaw" / "thalamus" / "state" / "opq_rotation.npy"
CONCEPT_TELEMETRY_PATH = HOME / ".openclaw" / "thalamus" / "state" / "concept_route_telemetry.jsonl"
_CODEBOOK = None
_OPQ_ROTATION = None

def concept_enabled() -> bool:
    return os.environ.get("THALAMUS_CONCEPT_CODES") == "1"

def load_codebook():
    global _CODEBOOK
    if _CODEBOOK is not None:
        return _CODEBOOK
    if not CODEBOOK_PATH.exists():
        return None
    import faiss
    _CODEBOOK = faiss.read_index(str(CODEBOOK_PATH))
    return _CODEBOOK

def load_opq_rotation():
    global _OPQ_ROTATION
    if _OPQ_ROTATION is not None:
        return _OPQ_ROTATION
    if not OPQ_ROTATION_PATH.exists():
        return None
    _OPQ_ROTATION = np.load(OPQ_ROTATION_PATH).astype(np.float32)
    return _OPQ_ROTATION

def _norm1(vec):
    arr = np.asarray(vec, dtype=np.float32).reshape(1, -1)
    n = np.linalg.norm(arr, axis=1, keepdims=True) + 1e-12
    return arr / n

def _cos(a, b):
    aa=_norm1(a); bb=_norm1(b)
    return float((aa*bb).sum())

def _concept_encode_decode(vec):
    idx = load_codebook()
    if idx is None:
        return None, None, None
    arr = _norm1(vec)
    opq = load_opq_rotation()
    encoded_arr = arr @ opq.T if opq is not None else arr
    codes = idx.sa_encode(encoded_arr.astype(np.float32))
    recon = idx.sa_decode(codes)
    if opq is not None:
        recon = recon @ opq
    return codes[0].astype(np.uint8).tolist(), recon[0].astype(np.float32).tolist(), _cos(arr[0], recon[0])

def _codebook_meta() -> Dict[str, Any]:
    try:
        return json.load(open(CODEBOOK_META_PATH))
    except Exception:
        return {}

def _concept_dim_ok(vec) -> tuple[bool, str]:
    meta = _codebook_meta()
    if not meta.get("ok"):
        return False, "codebook_not_ok"
    if int(meta.get("dim") or 0) != len(vec):
        return False, f"dim_mismatch:{len(vec)}!={meta.get('dim')}"
    return True, "ok"

def handle_concept_encode(params: Dict[str, Any]) -> Dict[str, Any]:
    if not concept_enabled(): return {"ok": False, "path": "vector", "reason": "disabled"}
    vec = params.get("vector") or []
    dim_ok, dim_reason = _concept_dim_ok(vec)
    if not dim_ok: return {"ok": False, "path": "vector", "reason": dim_reason}
    codes, recon, cos = _concept_encode_decode(vec)
    if codes is None: return {"ok": False, "path": "vector", "reason": "no_codebook"}
    return {"ok": True, "codes": codes, "recon_cos": round(cos, 6), "bytes": len(codes)}

def handle_concept_decode(params: Dict[str, Any]) -> Dict[str, Any]:
    if not concept_enabled(): return {"ok": False, "path": "vector", "reason": "disabled"}
    idx=load_codebook()
    if idx is None: return {"ok": False, "path": "vector", "reason": "no_codebook"}
    codes=np.asarray([params.get("codes") or []], dtype=np.uint8)
    recon=idx.sa_decode(codes)
    opq = load_opq_rotation()
    if opq is not None:
        recon = recon @ opq
    recon=recon[0].astype(np.float32)
    return {"ok": True, "vector": recon.tolist(), "vector_dim": int(recon.shape[0])}

def handle_concept_route_decision(params: Dict[str, Any]) -> Dict[str, Any]:
    reason=""; out={"path":"vector"}
    if not concept_enabled(): reason="disabled"
    elif not CODEBOOK_PATH.exists(): reason="no_codebook"
    else:
        vec = params.get("vector") or []
        dim_ok, dim_reason = _concept_dim_ok(vec)
        if not dim_ok:
            reason = dim_reason
        else:
            codes, recon, cos = _concept_encode_decode(vec)
            meta=_codebook_meta()
            coverage=float(meta.get("coverage_estimate", 1.0))
            if cos < 0.90: reason=f"recon_cos={cos:.3f}<0.90"
            elif coverage < 0.95: reason="low_coverage"
            else:
                out={"path":"code", "reason":"ok", "codes":codes, "recon_cos":round(cos,6), "coverage_estimate":coverage}
                reason=None
    if reason: out={"path":"vector", "reason":reason}
    try:
        CONCEPT_TELEMETRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CONCEPT_TELEMETRY_PATH.open('a') as f: f.write(json.dumps({"ts":time.time(), **out})+'\n')
    except Exception: pass
    return {"ok": True, **out}

def handle_health(_params: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ok": True,
        "uptime_s": round(time.time() - START_TS, 2),
        "rss_mb": round(get_rss_mb(), 1),
        "loaded_encoders": [
            {
                "name": name,
                "kind": entry["kind"],
                "dim": entry["dim"],
                "load_ms": round(entry["load_ms"], 1),
                "loaded_at": round(entry["loaded_at"], 2),
            }
            for name, entry in LOADED_MODELS.items()
        ],
        "socket": str(SOCKET_PATH),
        "qwen3_models": {k: str(v) for k, v in QWEN3_MODELS.items()},
    }


def handle_unload(params: Dict[str, Any]) -> Dict[str, Any]:
    name = params.get("name")
    if name in LOADED_MODELS:
        del LOADED_MODELS[name]
        log(f"unloaded {name}, RSS={get_rss_mb():.0f}MB")
        return {"ok": True, "unloaded": name, "rss_mb": round(get_rss_mb(), 1)}
    return {"ok": False, "error": f"model {name!r} not loaded"}


METHODS = {
    "embed_text": handle_embed_text,
    "embed_text_qwen3": handle_embed_text_qwen3,
    "embed_text_gte": handle_embed_text_gte,
    "embed_clip_text": handle_embed_clip_text,
    "embed_clip_image": handle_embed_clip_image,
    "embed_audio_whisper": handle_embed_audio_whisper,
    "health": handle_health,
    "unload": handle_unload,
    "concept_encode": handle_concept_encode,
    "concept_decode": handle_concept_decode,
    "concept_route_decision": handle_concept_route_decision,
}


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername") or "anon"
    try:
        line = await asyncio.wait_for(reader.readline(), timeout=120.0)
    except asyncio.TimeoutError:
        writer.close()
        await writer.wait_closed()
        return
    if not line:
        writer.close()
        await writer.wait_closed()
        return
    raw = line.decode("utf-8", errors="replace").strip()
    response: Dict[str, Any] = {"ok": False, "error": "unknown"}
    try:
        req = json.loads(raw)
        method = req.get("method")
        params = req.get("params", {}) or {}
        req_id = req.get("id")
        if method not in METHODS:
            response = {"ok": False, "error": f"unknown method {method!r}", "id": req_id}
        else:
            # CPU-bound (model encode) — run in default executor to keep loop responsive
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(None, METHODS[method], params)
            if isinstance(response, dict):
                response.setdefault("id", req_id)
    except json.JSONDecodeError as e:
        response = {"ok": False, "error": f"invalid JSON: {e}"}
    except Exception as e:  # noqa: BLE001
        log(f"handler error: {type(e).__name__}: {e}")
        response = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    try:
        writer.write((json.dumps(response) + "\n").encode("utf-8"))
        await writer.drain()
    except Exception as e:  # noqa: BLE001
        log(f"write error to {peer}: {e}")
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def serve() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        try:
            SOCKET_PATH.unlink()
        except FileNotFoundError:
            pass
    server = await asyncio.start_unix_server(handle_client, path=str(SOCKET_PATH))
    os.chmod(str(SOCKET_PATH), 0o600)
    log(f"serving on {SOCKET_PATH} (perms 0600), pid={os.getpid()}")

    stop = asyncio.Event()

    def _shutdown(*_):
        log("shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            pass

    async with server:
        await stop.wait()
    try:
        SOCKET_PATH.unlink()
    except FileNotFoundError:
        pass
    log("shutdown complete")


def client_call(method: str, params: Dict[str, Any], timeout: float = 60.0) -> Dict[str, Any]:
    """Sync client (used by --health, --bench)."""
    import socket as _socket
    s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect(str(SOCKET_PATH))
    payload = json.dumps({"method": method, "params": params, "id": 1}) + "\n"
    s.sendall(payload.encode("utf-8"))
    chunks = []
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
        if b"\n" in chunk:
            break
    s.close()
    raw = b"".join(chunks).decode("utf-8").strip()
    return json.loads(raw)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--health", action="store_true", help="probe health via existing socket")
    ap.add_argument("--bench", action="store_true", help="quick benchmark via existing socket")
    args = ap.parse_args()

    if args.health:
        try:
            print(json.dumps(client_call("health", {}, timeout=5), indent=2))
            return 0
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(e)}, indent=2))
            return 1

    if args.bench:
        results = []
        for i, text in enumerate(["BTC fiyatı", "merhaba dünya", "hello world"]):
            t0 = time.time()
            method = "embed_text_qwen3" if os.environ.get("THALAMUS_BENCH_QWEN3") == "1" else "embed_text"
            r = client_call(method, {"text": text}, timeout=120)
            wall_ms = (time.time() - t0) * 1000
            results.append({
                "i": i, "text": text,
                "ok": r.get("ok"),
                "vector_dim": r.get("vector_dim"),
                "encode_ms_server": r.get("encode_ms"),
                "wall_ms_total": round(wall_ms, 2),
                "rss_mb": r.get("rss_mb"),
            })
        print(json.dumps({"ok": True, "calls": results}, indent=2))
        return 0

    asyncio.run(serve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
