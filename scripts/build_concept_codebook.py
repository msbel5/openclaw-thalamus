#!/usr/bin/env python3
from __future__ import annotations
import json, time
from pathlib import Path
import numpy as np

HOME = Path.home()
STATE = HOME / ".openclaw/thalamus/state"
CORPUS = STATE / "corpus"
CODEBOOK = STATE / "codebook.faiss"
META = STATE / "codebook_metadata.json"
OPQ = STATE / "opq_rotation.npy"

def l2(x):
    n = np.linalg.norm(x, axis=1, keepdims=True) + 1e-12
    return x / n

def eval_recon(x, recon):
    sims = (l2(x) * l2(recon)).sum(axis=1)
    return float(np.mean(sims)), float(np.percentile(sims, 10)), sims

def read_embeddings():
    f = CORPUS / "embeddings.npy"
    n = f.stat().st_size // (512 * 2)
    emb = np.memmap(f, dtype="float16", mode="r", shape=(n, 512)).astype("float32")
    return l2(emb)

def save_opq(opq):
    import faiss
    try:
        arr = faiss.vector_to_array(opq.A).reshape(512, 512).astype("float32")
        np.save(OPQ, arr)
        return str(OPQ)
    except Exception:
        return None

def train_opq_pq(train, hold, m=64):
    import faiss
    t = time.time()
    opq = faiss.OPQMatrix(512, m)
    opq.niter = 25
    opq.niter_pq = 8
    opq.train(train)
    rotated_train = opq.apply_py(train)
    rotated_hold = opq.apply_py(hold)
    pq = faiss.IndexPQ(512, m, 8)
    pq.train(rotated_train)
    pq.add(rotated_train[:1])
    codes = pq.sa_encode(rotated_hold)
    recon_rot = pq.sa_decode(codes)
    recon = opq.reverse_transform(recon_rot)
    mean, p10, _ = eval_recon(hold, recon)
    faiss.write_index(pq, str(CODEBOOK))
    opq_path = save_opq(opq)
    return {"kind": "OPQ+PQ", "m": m, "nbits": 8, "mean": mean, "p10": p10, "train_s": round(time.time() - t, 2), "opq_rotation": opq_path}

def train_pq(train, hold, m):
    import faiss
    t = time.time()
    pq = faiss.IndexPQ(512, m, 8)
    pq.train(train)
    pq.add(train[:1])
    codes = pq.sa_encode(hold)
    recon = pq.sa_decode(codes)
    mean, p10, _ = eval_recon(hold, recon)
    return {"kind": "PQ", "m": m, "nbits": 8, "mean": mean, "p10": p10, "train_s": round(time.time() - t, 2)}

def main():
    started = time.time()
    emb = read_embeddings()
    rng = np.random.default_rng(42)
    idx = rng.permutation(len(emb))
    hold_n = min(2000, max(1000, len(emb) // 10))
    hold = emb[idx[:hold_n]]
    train = emb[idx[hold_n:]]
    attempts = []
    chosen = train_opq_pq(train, hold, 64)
    attempts.append(chosen)
    ok = chosen["mean"] >= 0.90 and chosen["p10"] >= 0.85
    if ok:
        # Optional optimization only after OPQ m=64 passes.
        for m in [32, 16, 8]:
            cand = train_pq(train, hold, m)
            attempts.append(cand)
            if cand["mean"] >= 0.90 and cand["p10"] >= 0.85 and cand["m"] < chosen["m"]:
                chosen = cand
                import faiss
                pq = faiss.IndexPQ(512, m, 8)
                pq.train(train)
                pq.add(train[:1])
                faiss.write_index(pq, str(CODEBOOK))
                if OPQ.exists():
                    OPQ.unlink()
                break
    meta = {
        "ok": ok,
        "chosen": chosen,
        "attempts": attempts,
        "N": int(len(emb)),
        "dim": 512,
        "codebook_bytes": CODEBOOK.stat().st_size if CODEBOOK.exists() else 0,
        "opq_rotation_bytes": OPQ.stat().st_size if OPQ.exists() else 0,
        "wall_s": round(time.time() - started, 2),
        "enabled_default": bool(ok),
        "coverage_estimate": 1.0 if ok else 0.0,
        "failure_mode": None if ok else "opq_50k_ceiling",
    }
    META.write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta))

if __name__ == "__main__":
    main()
