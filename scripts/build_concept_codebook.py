#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math, os, time
from pathlib import Path
import numpy as np

HOME = Path.home()
STATE = HOME / ".openclaw/thalamus/state"
CORPUS = STATE / "corpus"
CODEBOOK = STATE / "codebook.faiss"
META = STATE / "codebook_metadata.json"
OPQ = STATE / "opq_rotation.npy"

def l2(x):
    x = np.asarray(x, dtype=np.float32)
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-12)

def eval_recon(x, recon):
    sims = (l2(x) * l2(recon)).sum(axis=1)
    return float(np.mean(sims)), float(np.percentile(sims, 10)), sims

def read_embeddings(prefer="auto"):
    candidates=[]
    if prefer in ("auto","qwen3"):
        candidates += [(CORPUS/"embeddings_qwen3.npy", 1024, "qwen3")]
    if prefer in ("auto","distiluse"):
        candidates += [(CORPUS/"embeddings.npy", 512, "distiluse")]
    for f, dim, enc in candidates:
        if f.exists() and f.stat().st_size >= dim*2:
            n = f.stat().st_size // (dim * 2)
            emb = np.memmap(f, dtype="float16", mode="r", shape=(n, dim)).astype("float32")
            return l2(emb), f, dim, enc
    raise FileNotFoundError("no embeddings file found")

def recall_at_k(index, base, query, k=10, nq=200):
    nq=min(nq, len(query))
    q=query[:nq].astype(np.float32)
    Dtrue = q @ base.T
    truth = np.argsort(-Dtrue, axis=1)[:, :k]
    D,I = index.search(q, k)
    hits=0
    for a,b in zip(truth, I): hits += len(set(map(int,a)) & set(map(int,b)))
    return hits/(nq*k)

def train_bbq(train, hold, dim, nlist):
    import faiss
    t=time.time(); spec=f"IVF{nlist},RaBitQ"
    idx=faiss.index_factory(dim, spec, faiss.METRIC_INNER_PRODUCT)
    idx.train(train); idx.add(train)
    codes=idx.sa_encode(hold)
    recon=idx.sa_decode(codes)
    mean,p10,_=eval_recon(hold, recon)
    rec10=recall_at_k(idx, train, hold, 10, min(300, len(hold)))
    faiss.write_index(idx, str(CODEBOOK))
    return {"kind":"BBQ", "faiss_spec":spec, "mean":mean, "p10":p10, "recall@10":rec10, "train_s":round(time.time()-t,2), "code_size": int(idx.sa_code_size())}

def train_opq_pq(train, hold, dim, m):
    import faiss
    t=time.time(); opq=faiss.OPQMatrix(dim,m); opq.niter=25; opq.niter_pq=8; opq.train(train)
    rt=opq.apply_py(train); rh=opq.apply_py(hold)
    pq=faiss.IndexPQ(dim,m,8); pq.train(rt); pq.add(rt[:1])
    codes=pq.sa_encode(rh); recon=opq.reverse_transform(pq.sa_decode(codes))
    mean,p10,_=eval_recon(hold,recon); faiss.write_index(pq, str(CODEBOOK))
    try:
        arr=faiss.vector_to_array(opq.A).reshape(dim,dim).astype("float32"); np.save(OPQ, arr); opq_path=str(OPQ)
    except Exception: opq_path=None
    return {"kind":"OPQ-on-Qwen3" if dim==1024 else "OPQ+PQ", "m":m, "nbits":8, "mean":mean, "p10":p10, "recall@10":None, "train_s":round(time.time()-t,2), "opq_rotation":opq_path}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--prefer", choices=["auto","qwen3","distiluse"], default="auto"); ap.add_argument("--holdout", type=int, default=2000); args=ap.parse_args()
    started=time.time(); emb, file, dim, enc = read_embeddings(args.prefer)
    rng=np.random.default_rng(42); idx=rng.permutation(len(emb)); hold_n=min(args.holdout, max(500, len(emb)//10))
    hold=emb[idx[:hold_n]].astype("float32"); train=emb[idx[hold_n:]].astype("float32")
    attempts=[]; failure_mode=None
    try:
        import faiss
        rabitq_available=hasattr(faiss,"IndexIVFRaBitQ")
    except Exception:
        rabitq_available=False
    if rabitq_available:
        nlist=max(16, min(256, int(math.sqrt(len(train)))))
        chosen=train_bbq(train, hold, dim, nlist); attempts.append(chosen)
        ok=chosen["mean"]>=0.95 and chosen["p10"]>=0.90 and chosen.get("recall@10",0)>=0.95
        if not ok: failure_mode=f"bbq_ceiling_at_{dim}_{enc}"
    else:
        chosen={"kind":"BBQ", "ok":False, "error":"RaBitQ unavailable in FAISS build"}; attempts.append(chosen); ok=False; failure_mode="bbq_unavailable_faiss_build"
    if not ok:
        m=64 if dim % 64 == 0 else max(8, dim//16)
        opq=train_opq_pq(train, hold, dim, m); attempts.append(opq); chosen=opq
        ok=opq["mean"]>=0.95 and opq["p10"]>=0.90
        if not ok: failure_mode=f"opq_{enc}_ceiling"
    meta={"ok":bool(ok), "chosen":chosen, "attempts":attempts, "N":int(len(emb)), "dim":dim, "encoder":enc, "embeddings_file":str(file), "codebook_bytes":CODEBOOK.stat().st_size if CODEBOOK.exists() else 0, "opq_rotation_bytes":OPQ.stat().st_size if OPQ.exists() else 0, "wall_s":round(time.time()-started,2), "enabled_default":bool(ok), "coverage_estimate":1.0 if ok else 0.0, "failure_mode":None if ok else failure_mode}
    META.write_text(json.dumps(meta, indent=2)+"\n"); print(json.dumps(meta, indent=2))
if __name__=="__main__": main()
