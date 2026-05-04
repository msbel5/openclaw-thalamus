#!/usr/bin/env python3
from __future__ import annotations
import json, os, time
from pathlib import Path
import numpy as np
HOME=Path.home(); STATE=HOME/'.openclaw/thalamus/state'; CORPUS=STATE/'corpus'; CODEBOOK=STATE/'codebook.faiss'; META=STATE/'codebook_metadata.json'

def l2(x):
    n=np.linalg.norm(x,axis=1,keepdims=True)+1e-12; return x/n

def eval_recon(x, recon):
    sims=(l2(x)*l2(recon)).sum(axis=1); return float(np.mean(sims)), float(np.percentile(sims,10)), sims

def main():
    import faiss
    started=time.time(); emb=np.load(CORPUS/'embeddings.npy').astype('float32')
    if emb.ndim!=2 or emb.shape[1]!=512: raise SystemExit('bad embeddings shape')
    emb=l2(emb); rng=np.random.default_rng(42); idx=rng.permutation(len(emb)); hold=emb[idx[:min(1000,len(emb)//5)]]; train=emb[idx[min(1000,len(emb)//5):]]
    attempts=[]
    for m in [8,16,32,64]:
        pq=faiss.IndexPQ(512,m,8); t=time.time(); pq.train(train); pq.add(train[:1])
        codes=pq.sa_encode(hold); recon=pq.sa_decode(codes); mean,p10,_=eval_recon(hold,recon)
        attempts.append({'kind':'PQ','m':m,'nbits':8,'mean':mean,'p10':p10,'train_s':round(time.time()-t,2)})
        if mean>=0.90 and p10>=0.85:
            faiss.write_index(pq,str(CODEBOOK)); chosen=attempts[-1]; break
    else:
        chosen=attempts[-1]; faiss.write_index(pq,str(CODEBOOK))
    meta={'ok': chosen['mean']>=0.90 and chosen['p10']>=0.85, 'chosen':chosen,'attempts':attempts,'N':int(len(emb)),'dim':512,'codebook_bytes':CODEBOOK.stat().st_size,'wall_s':round(time.time()-started,2),'enabled_default':False,'coverage_estimate':1.0 if chosen['p10']>=0.85 else 0.0}
    META.write_text(json.dumps(meta,indent=2)+'\n'); print(json.dumps(meta))
if __name__=='__main__': main()
