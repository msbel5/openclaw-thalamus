#!/usr/bin/env python3
from __future__ import annotations
import json, random, time
from pathlib import Path
from eval_inspector import score_prompt, verdict_stats
HOME=Path.home(); CAP=HOME/'.openclaw/workspace/captain/AGENT.md'; OUT=HOME/'.openclaw/workspace/memory'
random.seed(42)
base=CAP.read_text(errors='ignore')
mutations=[
 ('baseline', base),
 ('packet_first', base+'\n\nGEPA candidate: Always resolve Thalamus packet before delegating and cite packet evidence.\n'),
 ('vector_gate', base+'\n\nGEPA candidate: Prefer inline_vector search before full text resolve; keep Mami-facing prose natural.\n'),
 ('inspector_loop', base+'\n\nGEPA candidate: On Inspector REJECTED reroute Builder fix-mode once, preserve PR evidence.\n'),
]
rows=[]
for gen in range(5):
    next_rows=[]
    for name,prompt in mutations:
        s=score_prompt(prompt)+gen*0.0001
        next_rows.append({'generation':gen,'candidate':name,'score':round(s,6),'tokens_est':len(prompt)//4})
    rows.extend(next_rows)
    best=max(next_rows,key=lambda r:r['score'])['candidate']
    mutations=[(n, p+'\n# reflective note: keep '+best+' behavior concise.\n') for n,p in mutations]
best=max(rows,key=lambda r:r['score']); a,r,t=verdict_stats()
OUT.mkdir(parents=True,exist_ok=True); report=OUT/f'gepa_captain_proposal_{int(time.time())}.md'
report.write_text('# GEPA Captain Proposal\n\nmodel_used: deterministic scaffold; preferred runtime model github-copilot/gpt-5.4\nllm_calls: 0 / 200\nauto_deploy: false\n\n'+json.dumps({'best':best,'approved':a,'rejected':r,'total_artifacts':t,'rows':rows},indent=2)+'\n')
print(json.dumps({'ok':True,'report':str(report),'best':best,'llm_calls':0,'model':'github-copilot/gpt-5.4'},indent=2))
