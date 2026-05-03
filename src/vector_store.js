import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HAILO_ENCODERS, VECTOR_NAMESPACES, VECTOR_STORE_DIR } from "./config.js";
import { appendJsonl, ensureDirs, pathExists, readJsonSafe, sha256, stableId, writeJson } from "./system.js";

const DEFAULT_TEXT_NAMESPACE = "atoms.memory";

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

function textVector(text, dim) {
  const tokens = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return hashedBasis("empty", dim);
  const vec = zeroVector(dim);
  for (const token of tokens) {
    const basis = hashedBasis(`tok:${token}`, dim);
    const weight = Math.min(3, Math.max(1, token.length / 5));
    for (let i = 0; i < dim; i += 1) vec[i] += basis[i] * weight;
  }
  return l2Normalize(vec);
}

async function fileVector(file, dim, prefix) {
  const buffer = await fs.readFile(file);
  return hashedBasis(`${prefix}:${sha256(buffer.toString("base64"))}:${buffer.length}`, dim);
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

export async function upsertVector(entry) {
  await ensureDirs();
  const namespace = entry.namespace || DEFAULT_TEXT_NAMESPACE;
  const info = namespaceInfo(namespace);
  const vector = normalizeVectorToDim(entry.vector || [], info.dim, entry.source_namespace || namespace);
  const rows = await readNamespace(namespace);
  const id = entry.id || stableId("vec", { namespace, text: entry.text, path: entry.raw_payload_path });
  const next = {
    id,
    namespace,
    vector_dim: info.dim,
    native_dim: entry.native_dim || info.dim,
    vector,
    normalized_512: normalizeVectorToDim(vector, 512, namespace),
    side: entry.side || info.side,
    model: entry.model || info.model,
    text: entry.text || null,
    raw_payload_path: entry.raw_payload_path || null,
    source: entry.source || "thalamus",
    confidence: Number(entry.confidence ?? 0.5),
    degraded: Boolean(entry.degraded),
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
    vector_dim: next.vector_dim,
    degraded: next.degraded
  });
  return next;
}

function encoderProof(kind) {
  const key =
    kind === "audio"
      ? "whisper_10s"
      : kind === "image"
        ? "clip_image"
        : kind === "crossmodal"
          ? "clip_text"
          : null;
  const hef = key ? HAILO_ENCODERS[key] : null;
  return { hef, expected: Boolean(hef), runner: "deterministic-fallback-until-hef-wrapper" };
}

export async function embed(input = {}) {
  await ensureDirs();
  const text = String(input.text || "").trim();
  const audioPath = input.audio_path || input.audioPath || null;
  const imagePath = input.image_path || input.imagePath || null;
  const store = Boolean(input.store);
  const namespace = input.namespace || DEFAULT_TEXT_NAMESPACE;
  const embeddings = [];
  const warnings = [];

  if (text) {
    const requestedInfo = namespaceInfo(namespace);
    const native = textVector(text, 384);
    if (requestedInfo.dim === 384) {
      embeddings.push({
        namespace,
        vector_dim: 384,
        native_dim: 384,
        vector: native,
        normalized_512: normalizeVectorToDim(native, 512, namespace),
        side: "text",
        model: "minilm-l6-compatible-hash",
        text,
        confidence: 0.62,
        degraded: true,
        proof: {
          encoder: "MiniLM-compatible deterministic fallback",
          reason: "keeps vector-aware workflow online without network/model warmup"
        }
      });
    } else {
      embeddings.push({
        namespace: DEFAULT_TEXT_NAMESPACE,
        vector_dim: 384,
        native_dim: 384,
        vector: native,
        normalized_512: normalizeVectorToDim(native, 512, DEFAULT_TEXT_NAMESPACE),
        side: "text",
        model: "minilm-l6-compatible-hash",
        text,
        confidence: 0.62,
        degraded: true,
        proof: {
          encoder: "MiniLM-compatible deterministic fallback",
          reason: `requested namespace ${namespace} is ${requestedInfo.dim}d; native text side emitted to ${DEFAULT_TEXT_NAMESPACE}`
        }
      });
    }
    const cross = normalizeVectorToDim(textVector(text, 512), 512, "clip-text");
    embeddings.push({
      namespace: requestedInfo.dim === 512 ? namespace : "atoms.crossmodal",
      vector_dim: 512,
      native_dim: 512,
      vector: cross,
      normalized_512: cross,
      side: "crossmodal",
      model: "clip-text-compatible-hash",
      text,
      confidence: 0.55,
      degraded: true,
      proof: encoderProof("crossmodal")
    });
  }

  if (audioPath) {
    if (!(await pathExists(audioPath))) {
      warnings.push(`audio_path not found: ${audioPath}`);
    } else {
      const raw = await fileVector(audioPath, 512, "audio-raw");
      const transcriptHint = text || path.basename(audioPath);
      embeddings.push({
        namespace: "atoms.audio.raw",
        vector_dim: 512,
        native_dim: 512,
        vector: raw,
        normalized_512: raw,
        side: "audio",
        model: "hailo-whisper-encoder-compatible",
        raw_payload_path: audioPath,
        confidence: 0.55,
        degraded: true,
        proof: encoderProof("audio")
      });
      const textVec = textVector(transcriptHint, 384);
      embeddings.push({
        namespace: "atoms.audio.text",
        vector_dim: 384,
        native_dim: 384,
        vector: textVec,
        normalized_512: normalizeVectorToDim(textVec, 512, "atoms.audio.text"),
        side: "audio",
        model: "whisper-transcript-minilm-compatible",
        text: transcriptHint,
        raw_payload_path: audioPath,
        confidence: 0.5,
        degraded: true,
        proof: { decoder: "not invoked in v0.2 smoke path" }
      });
    }
  }

  if (imagePath) {
    if (!(await pathExists(imagePath))) {
      warnings.push(`image_path not found: ${imagePath}`);
    } else {
      const raw = await fileVector(imagePath, 512, "image-raw");
      const captionHint = text || path.basename(imagePath);
      embeddings.push({
        namespace: "atoms.image.raw",
        vector_dim: 512,
        native_dim: 512,
        vector: raw,
        normalized_512: raw,
        side: "image",
        model: "hailo-clip-image-compatible",
        raw_payload_path: imagePath,
        confidence: 0.55,
        degraded: true,
        proof: encoderProof("image")
      });
      const imageText = textVector(captionHint, 384);
      embeddings.push({
        namespace: "atoms.image.text",
        vector_dim: 384,
        native_dim: 384,
        vector: imageText,
        normalized_512: normalizeVectorToDim(imageText, 512, "atoms.image.text"),
        side: "image",
        model: "vlm-ocr-minilm-compatible",
        text: captionHint,
        raw_payload_path: imagePath,
        confidence: 0.5,
        degraded: true,
        proof: { caption_ocr: "not invoked in v0.2 smoke path" }
      });
      embeddings.push({
        namespace: "atoms.crossmodal",
        vector_dim: 512,
        native_dim: 512,
        vector: raw,
        normalized_512: raw,
        side: "image",
        model: "clip-shared-compatible",
        raw_payload_path: imagePath,
        confidence: 0.55,
        degraded: true,
        proof: encoderProof("image")
      });
    }
  }

  const stored = [];
  if (store) {
    for (const item of embeddings) stored.push(await upsertVector(item));
  }
  return {
    ok: embeddings.length > 0,
    embedding_id: stableId("emb", { text, audioPath, imagePath, namespace }),
    generated_at: new Date().toISOString(),
    embeddings,
    stored: stored.map((row) => ({ id: row.id, namespace: row.namespace, vector_dim: row.vector_dim })),
    warnings,
    degraded: embeddings.some((item) => item.degraded),
    proof: {
      namespaces: Object.keys(VECTOR_NAMESPACES),
      encoders: HAILO_ENCODERS
    }
  };
}

export async function search(input = {}) {
  await ensureDirs();
  const namespace = input.namespace || DEFAULT_TEXT_NAMESPACE;
  const info = namespaceInfo(namespace);
  let queryVector = Array.isArray(input.vector) ? input.vector.map(Number) : null;
  if (!queryVector && input.vector_id) {
    for (const ns of Object.keys(VECTOR_NAMESPACES)) {
      const found = (await readNamespace(ns)).find((row) => row.id === input.vector_id);
      if (found) {
        queryVector = found.vector;
        break;
      }
    }
  }
  if (!queryVector && input.text) {
    queryVector = textVector(input.text, 384);
  }
  if (!queryVector) return { ok: false, error: "thalamus_search requires vector, vector_id, or text" };
  const targetQuery = normalizeVectorToDim(queryVector, info.dim, input.source_namespace || "query");
  const rows = await readNamespace(namespace);
  const k = Number(input.k || 5);
  const threshold = Number(input.threshold ?? info.threshold ?? 0);
  const matches = rows
    .map((row) => ({
      id: row.id,
      namespace: row.namespace,
      side: row.side,
      model: row.model,
      vector_dim: row.vector_dim,
      similarity: cosine(targetQuery, normalizeVectorToDim(row.vector || [], info.dim, row.namespace)),
      text: row.text,
      raw_payload_path: row.raw_payload_path,
      source: row.source,
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
      if (!ids.length || ids.includes(row.id)) {
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
