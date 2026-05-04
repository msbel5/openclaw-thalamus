#!/usr/bin/env python3
from __future__ import annotations
import json, os, socket, statistics, time
from pathlib import Path

def call(method, params, timeout=120):
    sock=Path(os.environ.get("THALAMUS_ENCODER_SOCKET", str(Path.home()/".openclaw/thalamus/ipc.sock")))
    s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(timeout); s.connect(str(sock))
    s.sendall((json.dumps({"method":method,"params":params,"id":1})+"\n").encode())
    data=b""
    while b"\n" not in data:
        chunk=s.recv(1<<20)
        if not chunk: break
        data+=chunk
    s.close(); return json.loads(data.split(b"\n",1)[0].decode())

def pct(xs,p):
    xs=sorted(xs); return xs[min(len(xs)-1, int(round((len(xs)-1)*p/100)))]

def bench(variant, n=20):
    rows=[]; text="BTC fiyatı ve Bitcoin değeri Türkçe semantic retrieval testi"
    for i in range(n):
        t=time.time(); r=call("embed_text_qwen3", {"text":text,"variant":variant}, 180); wall=(time.time()-t)*1000
        rows.append({"i":i,"ok":r.get("ok"),"wall_ms":round(wall,2),"server_ms":r.get("encode_ms"),"dim":r.get("vector_dim"),"rss_mb":r.get("rss_mb"),"model":r.get("model"),"variant":r.get("variant"),"error":r.get("error")})
        if not r.get("ok"): break
    ok=[r for r in rows if r.get("ok")]
    out={"rows":rows,"ok":len(ok)==len(rows) and bool(ok)}
    if ok:
        warm=[r["wall_ms"] for r in ok[1:]] or [ok[0]["wall_ms"]]
        out.update({"p50_warm_ms":round(statistics.median(warm),2),"p99_warm_ms":round(pct(warm,99),2),"rss_mb":ok[-1].get("rss_mb"),"dim":ok[-1].get("dim"),"model":ok[-1].get("model")})
    return out

def main():
    out={"started_at":time.time(),"results":{}}
    for variant in ["q4_0","q3_k_m"]:
        out["results"][variant]=bench(variant, int(os.environ.get("PRDM_QWEN_BENCH_N","20")))
    print(json.dumps(out, indent=2))
if __name__=="__main__": main()
