#!/usr/bin/env python3
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import sys
import time
import traceback
import urllib.request
from pathlib import Path

import numpy as np

HOME = Path.home()
REPO = HOME / "projects-alcyone" / "openclaw-thalamus"
LOG_DIR = HOME / ".openclaw" / "thalamus" / "state"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = LOG_DIR / f"scheduler_bench-{int(time.time())}.log"
HEF_PATH = Path(os.environ.get("THALAMUS_CLIP_IMAGE_HEF", "/usr/local/hailo/resources/models/hailo10h/clip_vit_b_32_image_encoder.hef"))
MODEL = os.environ.get("THALAMUS_BENCH_LLM_MODEL", "qwen2.5-instruct:1.5b")
BASE_URL = os.environ.get("HAILO_OLLAMA_BASE_URL", "http://127.0.0.1:8000")
UNLOAD_FIRST = "--unload-first" in sys.argv or os.environ.get("THALAMUS_BENCH_UNLOAD_FIRST") == "1"


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a") as f:
        f.write(line + "\n")


def get_temp_c() -> float | None:
    try:
        return int(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000
    except Exception:
        return None


def get_mem_available_mb() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except Exception:
        return None
    return None


def http_json(path: str, payload: dict | None = None, timeout: int = 10) -> dict:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"content-type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
        return {"status": r.status, "json": json.loads(body) if body else {}}


def list_loaded_models() -> list[str]:
    try:
        data = http_json("/api/ps", timeout=5)["json"]
        return [item.get("model") or item.get("name") for item in data.get("models", [])]
    except Exception as e:
        return [f"ps_error:{type(e).__name__}:{e}"]


def unload_model() -> dict:
    # Ollama-compatible unload request. Some Hailo-Ollama builds accept this on
    # /api/generate even when /api/chat is the normal inference path.
    try:
        return http_json("/api/generate", {"model": MODEL, "prompt": "", "stream": False, "keep_alive": 0}, timeout=30)
    except Exception as e:
        return {"status": None, "json": {"error": f"{type(e).__name__}: {e}"}}


class CachedClipImage:
    def __init__(self, hef_path: Path):
        from hailo_platform import FormatType, HailoSchedulingAlgorithm, VDevice
        params = VDevice.create_params()
        params.group_id = "SHARED"
        params.scheduling_algorithm = HailoSchedulingAlgorithm.ROUND_ROBIN
        self.vdevice = VDevice(params)
        self.infer_model = self.vdevice.create_infer_model(str(hef_path))
        self.infer_model.input().set_format_type(FormatType.UINT8)
        for output in self.infer_model.outputs:
            self.infer_model.output(output.name).set_format_type(FormatType.FLOAT32)
        self.configured_cm = self.infer_model.configure()
        self.configured = self.configured_cm.__enter__()

    def run(self, arr: np.ndarray, timeout_ms: int = 10000) -> float:
        output_buffers = {
            output.name: np.empty(self.infer_model.output(output.name).shape, dtype=np.float32)
            for output in self.infer_model.outputs
        }
        bindings = self.configured.create_bindings(output_buffers=output_buffers)
        bindings.input().set_buffer(np.ascontiguousarray(arr))
        started = time.time()
        self.configured.run([bindings], timeout_ms)
        _ = [bindings.output(name).get_buffer().copy() for name in output_buffers]
        return (time.time() - started) * 1000

    def close(self) -> None:
        try:
            self.configured_cm.__exit__(None, None, None)
        finally:
            self.vdevice.release()


def llm_call(i: int) -> dict:
    payload = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": f"scheduler bench {i}: sadece OK yaz"}],
        "stream": False,
        "options": {"num_predict": 8, "temperature": 0}
    }).encode()
    req = urllib.request.Request(f"{BASE_URL}/api/chat", data=payload, headers={"content-type": "application/json"}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            body = r.read().decode("utf-8", "replace")
            data = json.loads(body) if body else {}
            return {"i": i, "ok": 200 <= r.status < 300, "status": r.status, "latency_ms": round((time.time()-t0)*1000, 2), "content_len": len(data.get("message", {}).get("content", ""))}
    except Exception as e:
        return {"i": i, "ok": False, "latency_ms": round((time.time()-t0)*1000, 2), "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    log(f"bench_log={LOG_PATH}")
    log(f"mode={'unload-first' if UNLOAD_FIRST else 'loaded'} model={MODEL}")
    log(f"start temp={get_temp_c()}C mem={get_mem_available_mb()}MB hef={HEF_PATH}")
    log(f"api_ps_before={list_loaded_models()}")
    if UNLOAD_FIRST:
        unload = unload_model()
        log(f"unload_status={unload.get('status')} unload_body={json.dumps(unload.get('json'), ensure_ascii=False)[:500]}")
        time.sleep(2)
        log(f"api_ps_after_unload={list_loaded_models()}")
    if (get_mem_available_mb() or 0) < 1300:
        log("FAIL: MemAvailable below 1300MB guard")
        return 2
    if (get_temp_c() or 99) > 72:
        log("FAIL: temp above 72C guard")
        return 2
    arr = np.zeros((1, 224, 224, 3), dtype=np.uint8)
    arr[:, :, :, 0] = 32
    arr[:, 48:176, 48:176, 1] = 220
    clip = None
    try:
        t0 = time.time()
        clip = CachedClipImage(HEF_PATH)
        log(f"vdevice_configure_ms={round((time.time()-t0)*1000,2)}")
        embed_latencies = []
        errors = []
        with cf.ThreadPoolExecutor(max_workers=2) as pool:
            llm_futures = [pool.submit(llm_call, i) for i in range(5)]
            for i in range(5):
                try:
                    ms = clip.run(arr)
                    embed_latencies.append(round(ms, 2))
                    log(f"clip_image[{i}]={ms:.2f}ms temp={get_temp_c()} mem={get_mem_available_mb()}")
                except Exception as e:
                    errors.append(f"clip_image[{i}] {type(e).__name__}: {e}")
            llm = [f.result() for f in llm_futures]
        for item in llm:
            log(f"llm[{item['i']}] ok={item.get('ok')} status={item.get('status')} latency={item.get('latency_ms')} err={item.get('error','')}")
            if not item.get("ok"):
                errors.append(f"llm[{item['i']}] {item.get('error')}")
        all_text = "\n".join(errors)
        no_device_errors = "HAILO_OUT_OF_PHYSICAL_DEVICES" not in all_text
        ok = not errors and no_device_errors and len(embed_latencies) == 5 and all(x < 5000 for x in embed_latencies)
        summary = {"ok": ok, "mode": "unload-first" if UNLOAD_FIRST else "loaded", "log": str(LOG_PATH), "embed_latencies_ms": embed_latencies, "llm": llm, "errors": errors, "api_ps_after": list_loaded_models(), "temp_c": get_temp_c(), "mem_available_mb": get_mem_available_mb()}
        log("SUMMARY " + json.dumps(summary, ensure_ascii=False))
        return 0 if ok else 1
    except Exception:
        log("FAIL exception\n" + traceback.format_exc())
        return 1
    finally:
        if clip is not None:
            try:
                clip.close()
            except Exception as e:
                log(f"close_error {type(e).__name__}: {e}")

if __name__ == "__main__":
    raise SystemExit(main())
