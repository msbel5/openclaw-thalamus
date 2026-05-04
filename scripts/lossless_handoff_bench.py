#!/usr/bin/env python3
from __future__ import annotations
import json, os, socket, time, urllib.request
from pathlib import Path
import numpy as np
HOME=Path.home(); STATE=HOME/'.openclaw/thalamus/state'; PACKETS=STATE/'packets'; BASE='http://127.0.0.1:18888'
KEY_PATH=HOME/'.openclaw/secrets/thalamus-api-key.txt'
KEY=KEY_PATH.read_text().strip() if KEY_PATH.exists() else ''

def token(x): return (len(json.dumps(x,ensure_ascii=False)) + 3)//4

def api(path, body=None):
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(BASE+path, data=data, headers={'content-type':'application/json','authorization':'Bearer '+KEY} if KEY else {'content-type':'application/json'}, method='POST' if body is not None else 'GET')
    t=time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        raw=r.read(); return json.loads(raw), (time.time()-t)*1000, len(raw)

def sock(method, params):
    payload=json.dumps({'method':method,'params':params,'id':1}).encode()+b'\n'
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(60); s.connect(str(HOME/'.openclaw/thalamus/ipc.sock')); s.sendall(payload); data=b''
        while b'\n' not in data: data+=s.recv(1<<20)
    return json.loads(data.split(b'\n',1)[0].decode())

def find_packets(n=5):
    rows=[]
    for p in sorted(PACKETS.glob('*.json'), key=lambda x:x.stat().st_mtime, reverse=True):
        try: d=json.load(open(p))
        except Exception: continue
        v=((d.get('vector_query') or {}).get('normalized_512'))
        if isinstance(v,list) and len(v)==512: rows.append(d)
        if len(rows)>=n: break
    return rows

def cosine(a,b):
    a=np.asarray(a,dtype='float32'); b=np.asarray(b,dtype='float32')
    return float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-12))

def concept_direct(vec):
    import faiss
    cb=STATE/'codebook.faiss'
    if not cb.exists(): return {'ok':False,'reason':'no_codebook'}
    idx=faiss.read_index(str(cb)); x=np.asarray([vec],dtype='float32'); x=x/(np.linalg.norm(x,axis=1,keepdims=True)+1e-12)
    t=time.time(); codes=idx.sa_encode(x); enc=(time.time()-t)*1000
    t=time.time(); rec=idx.sa_decode(codes); dec=(time.time()-t)*1000
    return {'ok':True,'codes':codes[0].astype('uint8').tolist(),'encode_ms':enc,'decode_ms':dec,'recon_cos':cosine(x[0],rec[0]),'bytes':int(codes.shape[1])}

def main():
    packets=find_packets(5); results=[]
    for pkt in packets:
        pid=pkt['packet_id']; rk=pkt['resolver_key']; vec=pkt['vector_query']['normalized_512']; ns=pkt['vector_query'].get('namespace') or 'atoms.memory'
        full, t_full, b_full = api(f'/api/resolve?packet_id={pid}&resolver_key={rk}')
        light, t_light, b_light = api(f'/api/resolve?packet_id={pid}&resolver_key={rk}&with_text=false&max_atoms=2')
        inline, t_inline, b_inline = api('/api/search/vector', {'vector':vec,'namespace':ns,'k':5,'threshold':0})
        bundle, t_bundle_save, b_bundle_save = api('/api/tensor-bundle', {'vector':vec,'namespace':ns,'model':pkt['vector_query'].get('model')})
        tbid=bundle.get('tensor_bundle_id')
        tbsearch, t_tb, b_tb = api('/api/search/vector', {'tensor_bundle_id':tbid,'namespace':ns,'k':5,'threshold':0})
        c=concept_direct(vec)
        old_tokens=token(full)+token({'text':pkt.get('task','')})
        new_tokens=token({'packet_id':pid,'resolver_key':rk,'inline_vector_dim':512,'inline_vector_namespace':ns})+token(inline)
        reduction=1-(new_tokens/max(1,old_tokens))
        results.append({'packet_id':pid,'namespace':ns,'full_bytes':b_full,'light_bytes':b_light,'inline_bytes':b_inline,'bundle_bytes':b_tb,'old_tokens':old_tokens,'new_tokens':new_tokens,'token_reduction':reduction,'latency_ms':{'full':t_full,'light':t_light,'inline':t_inline,'tensor_bundle':t_tb,'bundle_save':t_bundle_save},'inline_top':len(inline.get('matches',[])),'bundle_top':len(tbsearch.get('matches',[])),'concept':c})
    mean_reduction=sum(r['token_reduction'] for r in results)/len(results) if results else 0
    mean_inline=sum(r['latency_ms']['inline'] for r in results)/len(results) if results else 0
    concept_ok=[r['concept'] for r in results if r['concept'].get('ok')]
    out={'ok': bool(results), 'N':len(results), 'mean_token_reduction':mean_reduction, 'mean_inline_latency_ms':mean_inline, 'concept_mean_encode_ms': sum(c['encode_ms'] for c in concept_ok)/len(concept_ok) if concept_ok else None, 'results':results}
    path=HOME/'.openclaw/workspace/memory/PRD_J_lossless_handoff_bench.json'
    path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(out,ensure_ascii=False))
if __name__=='__main__': main()
