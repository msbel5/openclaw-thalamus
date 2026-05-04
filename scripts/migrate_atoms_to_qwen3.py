#!/usr/bin/env python3
from __future__ import annotations
import json, os, shutil, socket, time
from pathlib import Path
import numpy as np
HOME=Path.home(); VDIR=HOME/'.openclaw/thalamus/state/vectors'; SOCK=HOME/'.openclaw/thalamus/ipc.sock'
NS=['atoms.code','atoms.audit','atoms.plan','atoms.memory','atoms.audio.raw','atoms.audio.text','atoms.image.raw','atoms.image.text','atoms.crossmodal']

def l2(v):
    a=np.asarray(v,dtype=np.float32).reshape(-1); n=np.linalg.norm(a)+1e-12; return (a/n).astype(np.float32)
def proj(vec,target,seed):
    src=l2(vec)
    if len(src)==target: return src
    rng=np.random.default_rng(abs(hash((seed,len(src),target)))%(2**32))
    mat=rng.normal(0,1/np.sqrt(target),size=(len(src),target)).astype(np.float32)
    return l2(src @ mat)
def call_qwen(text):
    s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(180); s.connect(str(SOCK))
    s.sendall((json.dumps({'method':'embed_text_qwen3','params':{'text':text,'variant':'q4_0'},'id':1})+'\n').encode()); data=b''
    while b'\n' not in data: data+=s.recv(1<<20)
    s.close(); out=json.loads(data.split(b'\n',1)[0].decode())
    if not out.get('ok'): raise RuntimeError(out.get('error'))
    return l2(out['vector']), out

def main():
    backup=VDIR.parent/(f'vectors.distiluse.bak.{int(time.time())}')
    shutil.copytree(VDIR, backup)
    result={'ok':True,'backup':str(backup),'namespaces':{},'reembedded':0,'projected':0,'errors':[]}
    for ns in NS:
        f=VDIR/(ns+'.json')
        rows=json.load(open(f)) if f.exists() else []
        out=[]
        for row in rows:
            try:
                if row.get('text'):
                    vec, proof=call_qwen(row['text'])
                    row={**row,'vector_dim':1024,'native_dim':1024,'vector':vec.tolist(),'normalized_512':proj(vec,512,ns).tolist(),'normalized_1024':vec.tolist(),'model':'qwen3-embedding-0.6b-q4_0','degraded':False,'metadata':{**(row.get('metadata') or {}),'migrated_to_qwen3_at':time.time()},'proof':{**(row.get('proof') or {}),'qwen3':{'source':proof.get('source'),'encode_ms':proof.get('encode_ms'),'rss_mb':proof.get('rss_mb')}}}
                    result['reembedded']+=1
                else:
                    vec=proj(row.get('vector') or [],1024,ns)
                    row={**row,'vector_dim':1024,'vector':vec.tolist(),'normalized_512':proj(vec,512,ns).tolist(),'normalized_1024':vec.tolist(),'native_dim':row.get('native_dim') or len(row.get('vector') or []),'metadata':{**(row.get('metadata') or {}),'projected_to_1024_at':time.time()},'proof':{**(row.get('proof') or {}),'projection':'legacy 512d raw vector projected to 1024d for namespace cutover'}}
                    result['projected']+=1
            except Exception as e:
                result['errors'].append({'namespace':ns,'id':row.get('id'),'error':str(e)})
            out.append(row)
        f.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
        result['namespaces'][ns]={'count':len(out),'dim':1024}
    result['ok']=not result['errors']
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()
