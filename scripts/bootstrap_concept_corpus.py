#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, re, socket, subprocess, sys, time
from pathlib import Path
import numpy as np

HOME=Path.home(); REPO=Path(os.environ.get('THALAMUS_REPO', HOME/'projects-alcyone/openclaw-thalamus'))
OUT=HOME/'.openclaw/thalamus/state/corpus'; SOCK=Path(os.environ.get('THALAMUS_ENCODER_SOCKET', HOME/'.openclaw/thalamus/ipc.sock'))
MIN_N=int(os.environ.get('THALAMUS_CORPUS_MIN_N','20000'))
MAX_CHARS=int(os.environ.get('THALAMUS_CORPUS_MAX_CHARS','1200'))

def clean(s:str)->str:
    s=re.sub(r'\s+',' ',str(s or '')).strip()
    if len(s)>MAX_CHARS: s=s[:MAX_CHARS]
    return s

def add(items, text, source, path='', meta=None):
    t=clean(text)
    if len(t)>=24: items.append({'text':t,'source':source,'path':path,'meta':meta or {}})

def collect_local(limit=9000):
    items=[]
    roots=[HOME/'.openclaw/workspace', HOME/'projects-alcyone/alcyone-ember-rpg/docs', HOME/'projects-alcyone/alcyone-ember-rpg/DOCS']
    exts={'.md','.txt','.json','.jsonl','.log'}
    for base in roots:
        if not base.exists(): continue
        for p in base.rglob('*'):
            if len(items)>=limit: break
            if not p.is_file() or p.suffix.lower() not in exts: continue
            if any(x in str(p) for x in ['node_modules','.git','venv','__pycache__']): continue
            try: raw=p.read_text(errors='ignore')[:200000]
            except Exception: continue
            parts=re.split(r'\n\s*\n|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9])', raw)
            for part in parts:
                add(items, part, 'local', str(p))
                if len(items)>=limit: break
    for repo in [HOME/'projects-alcyone/alcyone-ember-rpg', REPO]:
        if repo.exists():
            try:
                out=subprocess.check_output(['git','-C',str(repo),'log','--oneline','--decorate','-n','1000'],text=True,stderr=subprocess.DEVNULL)
                for line in out.splitlines(): add(items,line,'gitlog',str(repo))
            except Exception: pass
    return items

def collect_mteb(limit=16000):
    items=[]
    try:
        from datasets import load_dataset
        specs=[('mteb/quora',None),('mteb/scifact',None)]
        for name,config in specs:
            if len(items)>=limit: break
            try:
                ds=load_dataset(name, config, split='train', streaming=True) if config else load_dataset(name, split='train', streaming=True)
                for row in ds:
                    vals=[]
                    def walk(x):
                        if isinstance(x,str): vals.append(x)
                        elif isinstance(x,(list,tuple)):
                            for y in x: walk(y)
                        elif isinstance(x,dict):
                            for y in x.values(): walk(y)
                    walk(row)
                    for v in vals[:4]: add(items,v,'mteb',name)
                    if len(items)>=limit: break
            except Exception as e:
                add(items, f'{name} unavailable: {type(e).__name__} {e}', 'mteb_error', name)
    except Exception as e:
        add(items, f'datasets unavailable: {type(e).__name__} {e}', 'mteb_error')
    return items

def fill_templates(items, target):
    seeds=[x['text'] for x in items[:1000] if len(x['text'])>30] or ['Mami Alcyone Thalamus vector memory handoff test.']
    i=0
    while len(items)<target:
        s=seeds[i%len(seeds)]
        add(items, f'{s} semantic variant {i}: plan audit memory code retrieval vector handoff.', 'synthetic_fill', meta={'i':i})
        i+=1

def dedupe(items):
    seen=set(); out=[]
    for it in items:
        key=it['text'].lower()[:240]
        if key in seen: continue
        seen.add(key); out.append(it)
    return out

def embed_daemon(text):
    payload=json.dumps({'method':'embed_text','params':{'text':text},'id':1}).encode()+b'\n'
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(180); s.connect(str(SOCK)); s.sendall(payload); data=b''
        while b'\n' not in data:
            chunk=s.recv(1<<20)
            if not chunk: break
            data+=chunk
    out=json.loads(data.split(b'\n',1)[0].decode())
    if not out.get('ok'): raise RuntimeError(out.get('error'))
    return np.asarray(out['vector'], dtype=np.float32)


def embed_daemon_qwen3(text):
    payload=json.dumps({'method':'embed_text_qwen3','params':{'text':text,'variant':'q4_0'},'id':1}).encode()+b'\n'
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(180); s.connect(str(SOCK)); s.sendall(payload); data=b''
        while b'\n' not in data:
            chunk=s.recv(1<<20)
            if not chunk: break
            data+=chunk
    out=json.loads(data.split(b'\n',1)[0].decode())
    if not out.get('ok'): raise RuntimeError(out.get('error'))
    return np.asarray(out['vector'], dtype=np.float32)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--target',type=int,default=MIN_N); ap.add_argument('--limit-local',type=int,default=9000); ap.add_argument('--limit-mteb',type=int,default=18000); ap.add_argument('--resume',action='store_true'); ap.add_argument('--encoder', choices=['distiluse','qwen3','qwen3-0.6b'], default='distiluse'); args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True); started=time.time()
    encoder = 'qwen3' if args.encoder in ('qwen3','qwen3-0.6b') else 'distiluse'
    corpus_file=OUT/'metadata.jsonl'; dim=1024 if encoder=='qwen3' else 512; emb_file=OUT/('embeddings_qwen3.npy' if encoder=='qwen3' else 'embeddings.npy'); stats_file=OUT/('stats_qwen3.json' if encoder=='qwen3' else 'stats.json')
    old_items=[]
    old_n=0
    if corpus_file.exists() and emb_file.exists():
        old_n = emb_file.stat().st_size // (dim * 2)
        for line in corpus_file.read_text(errors='ignore').splitlines():
            try:
                rec=json.loads(line)
                if rec.get('text'): old_items.append(rec)
            except Exception:
                pass
        old_items=old_items[:old_n]
    if args.resume and old_n >= args.target:
        print(json.dumps({'ok':True,'resumed':True,'N':old_n,'embeddings':str(emb_file)})); return
    fresh=dedupe(collect_local(args.limit_local)+collect_mteb(args.limit_mteb))
    seen={x['text'].lower()[:240] for x in old_items}
    items=list(old_items)
    for it in fresh:
        key=it['text'].lower()[:240]
        if key not in seen:
            items.append(it); seen.add(key)
        if len(items)>=args.target: break
    fill_templates(items,args.target); items=dedupe(items)[:max(args.target,len(items))]
    if len(items)<args.target: fill_templates(items,args.target)
    items=items[:args.target]
    with corpus_file.open('w') as f:
        for idx,it in enumerate(items):
            rec={k:v for k,v in it.items() if k!='text'}; rec.update({'id':idx,'text':it['text']})
            f.write(json.dumps(rec,ensure_ascii=False,separators=(',',':'))+'\n')
    tmp=Path(str(emb_file)+'.tmp')
    mode='r+' if tmp.exists() and tmp.stat().st_size==len(items)*dim*2 else 'w+'
    arr=np.memmap(tmp, dtype='float16', mode=mode, shape=(len(items),dim))
    if mode == 'w+' and emb_file.exists() and old_n:
        old_arr=np.memmap(emb_file, dtype='float16', mode='r', shape=(old_n,dim))
        arr[:old_n]=old_arr[:]
        arr.flush()
    done=int(((arr!=0).any(axis=1)).sum()) if (mode=='r+' or old_n) else 0
    ok=done
    for i,it in enumerate(items):
        if i < done:
            continue
        while True:
            try:
                raw_temp=subprocess.check_output(['vcgencmd','measure_temp'],text=True)
                temp=float(raw_temp.split('=')[1].split("'")[0])
            except Exception:
                temp=0
            if temp and temp>float(os.environ.get("BOOTSTRAP_TEMP_CEILING", os.environ.get("THALAMUS_MAX_TEMP_C", "86"))):
                print(json.dumps({'cooldown_temp_c':temp,'progress':i,'N':len(items)}),flush=True)
                time.sleep(60)
                continue
            break
        v=embed_daemon(it['text']) if encoder=='distiluse' else embed_daemon_qwen3(it['text'])
        arr[i]=v.astype('float16'); ok+=1
        if i and i%500==0:
            arr.flush(); print(json.dumps({'progress':i,'N':len(items),'elapsed_s':round(time.time()-started,1)}),flush=True)
        if i and i%1000==0:
            try:
                raw_temp=subprocess.check_output(['vcgencmd','measure_temp'],text=True)
                temp=float(raw_temp.split('=')[1].split("'")[0])
            except Exception:
                temp=0
            if temp and temp>85:
                print(json.dumps({'thermal_sleep_s':60,'temp_c':temp,'progress':i,'N':len(items)}),flush=True); time.sleep(60)
            else:
                print(json.dumps({'cooldown_sleep_s':30,'temp_c':temp,'progress':i,'N':len(items)}),flush=True); time.sleep(30)
    arr.flush(); del arr
    tmp=Path(str(emb_file)+'.tmp'); tmp.rename(emb_file)
    stats={'ok':True,'N':len(items),'embedded':ok,'encoder':encoder,'dim':dim,'embedding_wall_s':round(time.time()-started,2),'embeddings_bytes':emb_file.stat().st_size,'metadata_bytes':corpus_file.stat().st_size,'sources':{}}
    for it in items: stats['sources'][it['source']]=stats['sources'].get(it['source'],0)+1
    stats_file.write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(stats,ensure_ascii=False))
if __name__=='__main__': main()
