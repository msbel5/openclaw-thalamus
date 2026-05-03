import {
  HAILO_LOCAL_KEEP_ALIVE,
  HAILO_LOCAL_MODEL,
  HAILO_OLLAMA_BASE_URL
} from "./config.js";
import { redact, stableId } from "./system.js";

async function requestJson(path, options = {}) {
  const url = `${HAILO_OLLAMA_BASE_URL}${path}`;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 120_000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: redact(text) };
    }
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - started,
      json
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latency_ms: Date.now() - started,
      json: { error: redact(error.message || String(error)) }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLocalLlmStatus() {
  const response = await requestJson("/hailo/v1/list", { timeout: 10_000 });
  const models = Array.isArray(response.json?.models) ? response.json.models : [];
  return {
    ok: response.ok,
    provider: "hailo-ollama",
    endpoint: HAILO_OLLAMA_BASE_URL,
    default_model: HAILO_LOCAL_MODEL,
    models,
    default_model_available: models.includes(HAILO_LOCAL_MODEL),
    latency_ms: response.latency_ms,
    proof: {
      endpoint: "/hailo/v1/list",
      status: response.status,
      model_count: models.length
    },
    error: response.ok ? null : response.json?.error || response.json
  };
}

export async function runLocalInference(input = {}) {
  const prompt = String(input.prompt || "").trim();
  const model = String(input.model || HAILO_LOCAL_MODEL);
  const maxTokens = Number(input.max_tokens || input.maxTokens || 80);
  const temperature = Number(input.temperature ?? 0.2);
  const keepAlive = String(input.keep_alive ?? input.keepAlive ?? HAILO_LOCAL_KEEP_ALIVE);
  const unloadAfter = keepAlive === "0s" || keepAlive === "0";
  const system =
    input.system ||
    "You are Alcyone's local thalamus layer. Answer briefly, do not invent proof, and say when a task needs the cloud crew.";

  if (!prompt) {
    return {
      ok: false,
      available: false,
      error: "thalamus_local_inference requires prompt",
      on_device: false
    };
  }

  const status = await getLocalLlmStatus();
  if (!status.ok || !status.models.includes(model)) {
    return {
      ok: false,
      available: false,
      provider: "hailo-ollama",
      model,
      on_device: false,
      text: "",
      tokens_used: 0,
      latency_ms: status.latency_ms,
      proof: status.proof,
      error: status.ok
        ? `model not available: ${model}`
        : status.error || "hailo-ollama unavailable"
    };
  }

  const started = Date.now();
  const response = await requestJson("/api/chat", {
    method: "POST",
    timeout: Number(input.timeout_ms || input.timeoutMs || 180_000),
    body: {
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      options: {
        num_predict: maxTokens,
        temperature
      }
    }
  });

  const text = response.json?.message?.content || response.json?.response || "";
  let unload = null;
  if (response.ok && unloadAfter) {
    unload = await requestJson("/api/generate", {
      method: "POST",
      timeout: 30_000,
      body: {
        model,
        prompt: "",
        stream: false,
        keep_alive: 0
      }
    });
  }
  return {
    ok: response.ok && Boolean(text),
    available: response.ok,
    inference_id: stableId("local", { prompt, model, maxTokens }),
    provider: "hailo-ollama",
    model,
    on_device: response.ok,
    keep_alive: keepAlive,
    unload_after: unloadAfter,
    unload: unload ? { ok: unload.ok, status: unload.status, latency_ms: unload.latency_ms, error: unload.ok ? null : unload.json?.error || unload.json } : null,
    text: redact(text),
    tokens_used: response.json?.eval_count || null,
    latency_ms: Date.now() - started,
    total_duration_ns: response.json?.total_duration || null,
    done_reason: response.json?.done_reason || null,
    proof: {
      endpoint: "/api/chat",
      status: response.status,
      list_endpoint: status.proof,
      model_available: true
    },
    error: response.ok ? null : response.json?.error || response.json
  };
}
