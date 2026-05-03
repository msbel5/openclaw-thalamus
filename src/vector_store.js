import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  HAILO_APPS_DIR,
  HAILO_APPS_PYTHON,
  HAILO_ENCODERS,
  PROJECT_ROOT,
  VECTOR_NAMESPACES,
  VECTOR_STORE_DIR
} from "./config.js";
import { appendJsonl, ensureDirs, pathExists, readJsonSafe, runFile, sha256, stableId, writeJson } from "./system.js";
import { embedTextViaDaemon, isAvailable as isEncoderDaemonAvailable } from "./encoder_client.js";

const DEFAULT_TEXT_NAMESPACE = "atoms.memory";
const ENCODER_DAEMON_DISABLED = process.env.THALAMUS_ENCODER_DAEMON_DISABLED === "1";

function namespaceFile(namespace) {
  return path.join(VECTOR_STORE_DIR, `${namespace.replace(/[^a-z0-9_.-]/gi, "_")}.json`);
}

function namespaceInfo(namespace) {
  return VECTOR_NAMESPACES[namespace] || VECTOR_NAMESPACES[DEFAULT_TEXT_NAMESPACE];
}

function hashBytes(seed, counter) {
  return crypto.createHash("sha256").update(seed).update(String(counter)).digest();
}

function zeroVector(dim) {
  return Array.from({ length: dim }, () => 0);
}

export function l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return zeroVector(vec.length);
  return vec.map((value) => value / norm);
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : null;
}

function hashedBasis(seed, dim) {
  const vec = zeroVector(dim);
  let filled = 0;
  let counter = 0;
  while (filled < dim) {
    const chunk = hashBytes(seed, counter);
    for (let i = 0; i < chunk.length && filled < dim; i += 1) {
      vec[filled] = (chunk[i] / 127.5 - 1) || 0.0001;
      filled += 1;
    }
    counter += 1;
  }
  return l2Normalize(vec);
}

function fallbackVector(seed, dim) {
  return hashedBasis(seed || "empty", dim);
}

export function normalizeVectorToDim(vec, targetDim, sourceNamespace = "unknown") {
  const source = Array.isArray(vec) ? vec.map(Number) : [];
  if (source.length === targetDim) return l2Normalize(source);
  if (!source.length) return zeroVector(targetDim);
  const out = zeroVector(targetDim);
  for (let i = 0; i < source.length; i += 1) {
    const basis = hashedBasis(`projection:${sourceNamespace}:${source.length}->${targetDim}:${i}`, targetDim);
    for (let j = 0; j < targetDim; j += 1) out[j] += basis[j] * source[i];
  }
  return l2Normalize(out);
}

export function normalizePairwise(vecA, vecB, sourceA = "a", sourceB = "b") {
  if (vecA.length === vecB.length) {
    return { a: l2Normalize(vecA), b: l2Normalize(vecB), common_dim: vecA.length };
  }
  return {
    a: normalizeVectorToDim(vecA, 512, sourceA),
    b: normalizeVectorToDim(vecB, 512, sourceB),
    common_dim: 512
  };
}

async function readNamespace(namespace) {
  return (await readJsonSafe(namespaceFile(namespace), [])) || [];
}

async function writeNamespace(namespace, rows) {
  await writeJson(namespaceFile(namespace), rows);
}

function pythonEnv() {
  const existing = process.env.PYTHONPATH ? `${process.env.PYTHONPATH}:` : "";
  return {
    PYTHONPATH: `${PROJECT_ROOT}:${HAILO_APPS_DIR}:${existing}${process.env.PYTHONPATH || ""}`,
    HAILO_APPS_DIR
  };
}

function parseEncoderJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("encoder returned empty stdout");
  const line = text
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.trim().startsWith("{"));
  if (!line) throw new Error(`encoder returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(line);
}

async function runEncoder(moduleName, args, options = {}) {
  const result = await runFile(HAILO_APPS_PYTHON, ["-m", moduleName, ...args], {
    cwd: PROJECT_ROOT,
    env: pythonEnv(),
    timeout: options.timeout ?? 60_000
  });
  let payload = null;
  try {
    payload = parseEncoderJson(result.stdout);
  } catch (error) {
    payload = { ok: false, degraded: true, error: error.message, stderr: result.stderr };
  }
  if (!result.ok || payload?.degraded || !Array.isArray(payload?.vector)) {
    return {
      ok: false,
      vector: null,
      dim: 0,
      model: payload?.model || moduleName,
      degraded: true,
      latency_ms: payload?.latency_ms ?? result.ms,
      error: payload?.error || result.stderr || `encoder ${moduleName} failed`
    };
  }
  return {
    ok: true,
    vector: l2Normalize(payload.vector.map(Number)),
    dim: Number(payload.dim || payload.vector.length),
    model: payload.model || moduleName,
    degraded: false,
    latency_ms: payload.latency_ms ?? result.ms,
    proof: payload
  };
}

async function semanticText(text) {
  // Tier 1: encoder daemon over UNIX socket (warm path ~200ms, cold ~26s once).
  if (!ENCODER_DAEMON_DISABLED) {
    try {
      if (await isEncoderDaemonAvailable(800)) {
        const startedAt = Date.now();
        const r = await embedTextViaDaemon(text);
        return {
          ok: true,
          vector: l2Normalize(r.vector.map(Number)),
          dim: Number(r.vector_dim || r.vector.length),
          model: r.model || "distiluse-base-multilingual-cased-v2",
          degraded: false,
          latency_ms: r.encode_ms ?? (Date.now() - startedAt),
          proof: { source: r.source || "encoder-daemon", rss_mb: r.rss_mb }
        };
      }
    } catch (err) {
      console.warn(`[thalamus] encoder daemon path failed, falling back to subprocess: ${err.message}`);
    }
  }
  // Tier 2: legacy subprocess to Python module (cold ~67s).
  const out = await runEncoder("thalamus.vector.embed_text_semantic", [text], { timeout: 90_000 });
  if (out.ok) return out;
  console.warn(`[thalamus] semantic text encoder degraded: ${out.error}`);
  return {
    ok: false,
    vector: fallbackVector(`semantic:${text}`, 512),
    dim: 512,
    model: "deterministic-fallback",
    degraded: true,
    error: out.error
  };
}

async function clipText(text) {
  const out = await runEncoder("thalamus.vector.embed_text_clip", [text], { timeout: 60_000 });
  if (out.ok) return out;
  console.warn(`[thalamus] CLIP text encoder degraded: ${out.error}`);
  return {
    ok: false,
    vector: fallbackVector(`clip-text:${text}`, 512),
    dim: 512,
    model: "deterministic-fallback",
    degraded: true,
    error: out.error
  };
}

async function audioRaw(file) {
  const out = await runEncoder("thalamus.vector.embed_audio_whisper", [file], { timeout: 120_000 });
  if (out.ok) return out;
  console.warn(`[thalamus] Whisper encoder degraded: ${out.error}`);
  const buffer = await fs.readFile(file);
  return {
    ok: false,
    vector: fallbackVector(`audio:${sha256(buffer.toString("base64"))}:${buffer.length}`, 512),
    dim: 512,
    model: "deterministic-fallback",
    degraded: true,
    error: out.error
  };
}

async function imageRaw(file) {
  const out = await runEncoder("thalamus.vector.embed_image_clip", [file], { timeout: 60_000 });
  if (out.ok) return out;
  console.warn(`[thalamus] CLIP image encoder degraded: ${out.error}`);
  const buffer = await fs.readFile(file);
  return {
    ok: false,
    vector: fallbackVector(`image:${sha256(buffer.toString("base64"))}:${buffer.length}`, 512),
    dim: 512,
    model: "deterministic-fallback",
    degraded: true,
    error: out.error
  };
}

function encoderProof(kind, result) {
  const key =
    kind === "audio"
      ? "whisper_10s"
      : kind === "image"
        ? "clip_image"
        : kind === "crossmodal"
          ? "clip_text"
          : null;
  const hef = key ? HAILO_ENCODERS[key] : null;
  return {
    hef,
    expected: Boolean(hef),
    runner: result?.degraded ? "deterministic-fallback" : key ? "hailo-hef-runner" : "sentence-transformers",
    latency_ms: result?.latency_ms ?? null,
    error: result?.error || null
  };
}

export async function upsertVector(entry) {
  await ensureDirs();
  const namespace = entry.namespace || DEFAULT_TEXT_NAMESPACE;
  const info = namespaceInfo(namespace);
  const vector = normalizeVectorToDim(entry.vector || [], info.dim, entry.source_namespace || namespace);
  const rows = await readNamespace(namespace);
  const id =
    entry.id ||
    stableId("vec", {
      namespace,
      packet_id: entry.packet_id,
      text: entry.text,
      path: entry.raw_payload_path,
      source: entry.source,
      intent: entry.intent
    });
  const next = {
    id,
    packet_id: entry.packet_id || null,
    namespace,
    vector_dim: info.dim,
    native_dim: entry.native_dim || vector.length || info.dim,
    vector,
    normalized_512: normalizeVectorToDim(vector, 512, namespace),
    side: entry.side || info.side,
    model: entry.model || info.model,
    text: entry.text || null,
    raw_payload_path: entry.raw_payload_path || null,
    source: entry.source || "thalamus",
    intent: entry.intent || null,
    parent_packet_id: entry.parent_packet_id || null,
    confidence: Number(entry.confidence ?? 0.5),
    degraded: Boolean(entry.degraded),
    proof: entry.proof || {},
    metadata: entry.metadata || {},
    created_at: entry.created_at || new Date().toISOString()
  };
  const filtered = rows.filter((row) => row.id !== id);
  filtered.unshift(next);
  await writeNamespace(namespace, filtered.slice(0, 10000));
  await appendJsonl(path.join(VECTOR_STORE_DIR, "events.jsonl"), {
    ts: next.created_at,
    event: "upsert",
    namespace,
    id,
    packet_id: next.packet_id,
    vector_dim: next.vector_dim,
    degraded: next.degraded,
    source: next.source,
    intent: next.intent
  });
  return next;
}

function acceptsSemanticText(namespace) {
  const info = namespaceInfo(namespace);
  return info.side === "text" || namespace.endsWith(".text");
}

export async function embed(input = {}) {
  await ensureDirs();
  const text = String(input.text || "").trim();
  const audioPath = input.audio_path || input.audioPath || null;
  const imagePath = input.image_path || input.imagePath || null;
  const store = Boolean(input.store);
  const namespace = input.namespace || DEFAULT_TEXT_NAMESPACE;
  const source = input.source || "thalamus";
  const intent = input.intent || null;
  const parentPacketId = input.parent_packet_id || input.parentPacketId || null;
  const packetId = input.packet_id || input.packetId || null;
  const metadata = input.metadata || {};
  const embeddings = [];
  const warnings = [];

  if (text) {
    const textNamespace = acceptsSemanticText(namespace) ? namespace : DEFAULT_TEXT_NAMESPACE;
    const semantic = await semanticText(text);
    embeddings.push({
      namespace: textNamespace,
      packet_id: packetId,
      vector_dim: namespaceInfo(textNamespace).dim,
      native_dim: semantic.dim,
      vector: normalizeVectorToDim(semantic.vector, namespaceInfo(textNamespace).dim, semantic.model),
      normalized_512: normalizeVectorToDim(semantic.vector, 512, semantic.model),
      side: namespaceInfo(textNamespace).side,
      model: semantic.model,
      text,
      source,
      intent,
      parent_packet_id: parentPacketId,
      confidence: semantic.degraded ? 0.35 : 0.85,
      degraded: semantic.degraded,
      proof: encoderProof("text", semantic),
      metadata
    });

    const cross = await clipText(text);
    embeddings.push({
      namespace: "atoms.crossmodal",
      packet_id: packetId,
      vector_dim: 512,
      native_dim: cross.dim,
      vector: cross.vector,
      normalized_512: cross.vector,
      side: "crossmodal",
      model: cross.model,
      text,
      source,
      intent,
      parent_packet_id: parentPacketId,
      confidence: cross.degraded ? 0.35 : 0.82,
      degraded: cross.degraded,
      proof: encoderProof("crossmodal", cross),
      metadata
    });
  }

  if (audioPath) {
    if (!(await pathExists(audioPath))) {
      warnings.push(`audio_path not found: ${audioPath}`);
    } else {
      const raw = await audioRaw(audioPath);
      embeddings.push({
        namespace: "atoms.audio.raw",
        packet_id: packetId,
        vector_dim: 512,
        native_dim: raw.dim,
        vector: raw.vector,
        normalized_512: raw.vector,
        side: "audio",
        model: raw.model,
        raw_payload_path: audioPath,
        source,
        intent,
        parent_packet_id: parentPacketId,
        confidence: raw.degraded ? 0.35 : 0.82,
        degraded: raw.degraded,
        proof: encoderProof("audio", raw),
        metadata
      });
      const transcriptHint = text || path.basename(audioPath);
      const audioText = await semanticText(transcriptHint);
      embeddings.push({
        namespace: "atoms.audio.text",
        packet_id: packetId,
        vector_dim: 512,
        native_dim: audioText.dim,
        vector: audioText.vector,
        normalized_512: audioText.vector,
        side: "audio",
        model: audioText.model,
        text: transcriptHint,
        raw_payload_path: audioPath,
        source,
        intent,
        parent_packet_id: parentPacketId,
        confidence: audioText.degraded ? 0.35 : 0.7,
        degraded: audioText.degraded,
        proof: { decoder: "not invoked in v0.2.1 ingest path", semantic: encoderProof("text", audioText) },
        metadata
      });
    }
  }

  if (imagePath) {
    if (!(await pathExists(imagePath))) {
      warnings.push(`image_path not found: ${imagePath}`);
    } else {
      const raw = await imageRaw(imagePath);
      embeddings.push({
        namespace: "atoms.image.raw",
        packet_id: packetId,
        vector_dim: 512,
        native_dim: raw.dim,
        vector: raw.vector,
        normalized_512: raw.vector,
        side: "image",
        model: raw.model,
        raw_payload_path: imagePath,
        source,
        intent,
        parent_packet_id: parentPacketId,
        confidence: raw.degraded ? 0.35 : 0.82,
        degraded: raw.degraded,
        proof: encoderProof("image", raw),
        metadata
      });
      const captionHint = text || path.basename(imagePath);
      const imageText = await semanticText(captionHint);
      embeddings.push({
        namespace: "atoms.image.text",
        packet_id: packetId,
        vector_dim: 512,
        native_dim: imageText.dim,
        vector: imageText.vector,
        normalized_512: imageText.vector,
        side: "image",
        model: imageText.model,
        text: captionHint,
        raw_payload_path: imagePath,
        source,
        intent,
        parent_packet_id: parentPacketId,
        confidence: imageText.degraded ? 0.35 : 0.7,
        degraded: imageText.degraded,
        proof: { caption_ocr: "not invoked in JS embed path", semantic: encoderProof("text", imageText) },
        metadata
      });
      embeddings.push({
        namespace: "atoms.crossmodal",
        packet_id: packetId,
        vector_dim: 512,
        native_dim: raw.dim,
        vector: raw.vector,
        normalized_512: raw.vector,
        side: "image",
        model: raw.model,
        raw_payload_path: imagePath,
        source,
        intent,
        parent_packet_id: parentPacketId,
        confidence: raw.degraded ? 0.35 : 0.82,
        degraded: raw.degraded,
        proof: encoderProof("image", raw),
        metadata
      });
    }
  }

  const stored = [];
  if (store) {
    for (const item of embeddings) stored.push(await upsertVector(item));
  }
  return {
    ok: embeddings.length > 0,
    embedding_id: stableId("emb", { text, audioPath, imagePath, namespace, source, intent }),
    generated_at: new Date().toISOString(),
    embeddings,
    stored: stored.map((row) => ({
      id: row.id,
      packet_id: row.packet_id,
      namespace: row.namespace,
      vector_dim: row.vector_dim,
      source: row.source,
      intent: row.intent
    })),
    warnings,
    degraded: embeddings.some((item) => item.degraded),
    proof: {
      namespaces: Object.keys(VECTOR_NAMESPACES),
      encoders: HAILO_ENCODERS
    }
  };
}

function sourceMatches(source, filters = []) {
  if (!filters.length) return true;
  return filters.some((filter) => {
    if (filter.endsWith("*")) return String(source || "").startsWith(filter.slice(0, -1));
    return String(source || "") === filter;
  });
}

async function queryVectorForNamespace(input, namespace) {
  const info = namespaceInfo(namespace);
  if (Array.isArray(input.vector)) return input.vector.map(Number);
  if (input.vector_id) {
    for (const ns of Object.keys(VECTOR_NAMESPACES)) {
      const found = (await readNamespace(ns)).find((row) => row.id === input.vector_id);
      if (found) return found.vector;
    }
  }
  if (input.text) {
    if (info.side === "crossmodal" || namespace === "atoms.image.raw") {
      return (await clipText(input.text)).vector;
    }
    return (await semanticText(input.text)).vector;
  }
  return null;
}

export async function search(input = {}) {
  await ensureDirs();
  const namespace = input.namespace || DEFAULT_TEXT_NAMESPACE;
  const info = namespaceInfo(namespace);
  const queryVector = await queryVectorForNamespace(input, namespace);
  if (!queryVector) return { ok: false, error: "thalamus_search requires vector, vector_id, or text" };
  const targetQuery = normalizeVectorToDim(queryVector, info.dim, input.source_namespace || "query");
  const rows = await readNamespace(namespace);
  const k = Number(input.k || 5);
  const threshold = Number(input.threshold ?? info.threshold ?? 0);
  const sourceFilter = input.source_filter || input.sourceFilter || [];
  const matches = rows
    .filter((row) => sourceMatches(row.source, sourceFilter))
    .map((row) => ({
      id: row.id,
      packet_id: row.packet_id || null,
      namespace: row.namespace,
      side: row.side,
      model: row.model,
      vector_dim: row.vector_dim,
      similarity: cosine(targetQuery, normalizeVectorToDim(row.vector || [], info.dim, row.namespace)),
      text: row.text,
      raw_payload_path: row.raw_payload_path,
      source: row.source,
      intent: row.intent || null,
      parent_packet_id: row.parent_packet_id || null,
      confidence: row.confidence,
      degraded: row.degraded,
      metadata: row.metadata
    }))
    .filter((row) => row.similarity !== null && row.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
  return {
    ok: true,
    namespace,
    target_dim: info.dim,
    k,
    threshold,
    source_filter: sourceFilter,
    count: rows.length,
    matches
  };
}

export async function compare(input = {}) {
  const vecA = Array.isArray(input.vec_a) ? input.vec_a.map(Number) : input.a || [];
  const vecB = Array.isArray(input.vec_b) ? input.vec_b.map(Number) : input.b || [];
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || !vecA.length || !vecB.length) {
    return { ok: false, error: "thalamus_compare requires vec_a and vec_b arrays" };
  }
  const normalized = normalizePairwise(
    vecA,
    vecB,
    input.source_a || input.sourceA || "a",
    input.source_b || input.sourceB || "b"
  );
  return {
    ok: true,
    common_dim: normalized.common_dim,
    similarity: cosine(normalized.a, normalized.b),
    normalized_a: input.return_vectors ? normalized.a : undefined,
    normalized_b: input.return_vectors ? normalized.b : undefined
  };
}

export async function cluster(input = {}) {
  const ids = input.packet_ids || input.vector_ids || [];
  const threshold = Number(input.threshold || 0.85);
  const vectors = [];
  for (const ns of Object.keys(VECTOR_NAMESPACES)) {
    for (const row of await readNamespace(ns)) {
      if (!ids.length || ids.includes(row.id) || ids.includes(row.packet_id)) {
        vectors.push({ id: row.id, namespace: ns, vector: normalizeVectorToDim(row.vector, 512, ns) });
      }
    }
  }
  const parent = new Map(vectors.map((row) => [row.id, row.id]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pb, pa);
  };
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      if ((cosine(vectors[i].vector, vectors[j].vector) || 0) >= threshold) {
        union(vectors[i].id, vectors[j].id);
      }
    }
  }
  const clusters = {};
  for (const row of vectors) {
    const key = find(row.id);
    clusters[key] ||= [];
    clusters[key].push({ id: row.id, namespace: row.namespace });
  }
  return {
    ok: true,
    threshold,
    vector_count: vectors.length,
    cluster_count: Object.keys(clusters).length,
    clusters: Object.values(clusters)
  };
}

export async function initNamespaces(options = {}) {
  await ensureDirs();
  const result = { ok: true, namespaces: {}, migrated: 0, degraded_marked: 0 };
  for (const namespace of Object.keys(VECTOR_NAMESPACES)) {
    const file = namespaceFile(namespace);
    let rows = await readJsonSafe(file, null);
    if (!Array.isArray(rows)) rows = [];
    const info = namespaceInfo(namespace);
    const nextRows = [];
    for (const row of rows) {
      if (Number(row.vector_dim || 0) !== info.dim || !Array.isArray(row.vector) || row.vector.length !== info.dim) {
        if (options.migrate !== false && row.text && acceptsSemanticText(namespace)) {
          const semantic = await semanticText(row.text);
          nextRows.push({
            ...row,
            vector_dim: info.dim,
            native_dim: semantic.dim,
            vector: normalizeVectorToDim(semantic.vector, info.dim, semantic.model),
            normalized_512: normalizeVectorToDim(semantic.vector, 512, semantic.model),
            model: semantic.model,
            degraded: semantic.degraded,
            proof: { ...(row.proof || {}), migrated_by: "init-namespaces", semantic: encoderProof("text", semantic) }
          });
          result.migrated += 1;
        } else {
          nextRows.push({
            ...row,
            vector_dim: info.dim,
            vector: normalizeVectorToDim(row.vector || [], info.dim, row.namespace || namespace),
            normalized_512: normalizeVectorToDim(row.vector || [], 512, row.namespace || namespace),
            degraded: true,
            proof: { ...(row.proof || {}), degraded_reason: "dimension migrated without source text" }
          });
          result.degraded_marked += 1;
        }
      } else {
        nextRows.push(row);
      }
    }
    await writeNamespace(namespace, nextRows);
    result.namespaces[namespace] = { file, dim: info.dim, count: nextRows.length };
  }
  return result;
}

export async function getVectorStats() {
  await ensureDirs();
  const stats = {};
  for (const namespace of Object.keys(VECTOR_NAMESPACES)) {
    stats[namespace] = {
      ...VECTOR_NAMESPACES[namespace],
      count: (await readNamespace(namespace)).length
    };
  }
  return { ok: true, path: VECTOR_STORE_DIR, namespaces: stats };
}

