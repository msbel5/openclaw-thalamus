#!/usr/bin/env python3
from __future__ import annotations
import argparse, glob, json, re
from pathlib import Path
HOME=Path.home(); STATE=HOME/'.openclaw/workspace/state'; RUNS=HOME/'.openclaw/cron/runs'

def verdict_stats():
    texts=[]
    for pat in [str(STATE/'*inspector*.txt'), str(STATE/'ember-*inspector*.txt')]:
        for f in glob.glob(pat):
            try: texts.append(Path(f).read_text(errors='ignore'))
            except Exception: pass
    approved=sum(1 for t in texts if re.search(r'\bAPPROVED\b',t,re.I)); rejected=sum(1 for t in texts if re.search(r'\bREJECTED\b',t,re.I))
    return approved,rejected,len(texts)

def score_prompt(prompt:str):
    approved,rejected,total=verdict_stats()
    required=['thalamus','packet','inline_vector','inspector','evidence','test','pr']
    hits=sum(1 for w in required if w in prompt.lower())
    brevity=max(0,1-len(prompt)/12000)
    base=(approved/(approved+rejected)) if (approved+rejected) else 0.5
    return round(base*0.65 + (hits/len(required))*0.25 + brevity*0.10, 6)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--prompt-file'); args=ap.parse_args()
    prompt=Path(args.prompt_file).read_text(errors='ignore') if args.prompt_file else ''
    a,r,t=verdict_stats(); print(json.dumps({'score':score_prompt(prompt),'approved':a,'rejected':r,'total_artifacts':t},indent=2))
if __name__=='__main__': main()
