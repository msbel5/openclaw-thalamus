import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config.js";
import { appendJsonl, readJsonSafe, roughTokenEstimate } from "./system.js";

export const RUN_TELEMETRY_PATH = path.join(STATE_DIR, "run_telemetry.jsonl");
export const ALCYONE_PROTOCOL_VERSION = "alcyone-v1";

export function protocolAck() {
  return "@ack:alcyone-v1";
}

export function compactSpawnContext(context = {}) {
  const packetId = context.packet_id || context.thalamus_packet_id || context["@p"];
  const resolverKey = context.resolver_key || context.thalamus_resolver_key || context["@r"];
  const compact = {
    protocol_version: ALCYONE_PROTOCOL_VERSION,
    ack: protocolAck(),
    "@p": packetId,
    "@r": resolverKey,
    "@v": Array.isArray(context.inline_vector) ? 1 : 0,
    "@tb": context.tensor_bundle_id || null,
    "@ns": context.inline_vector_namespace || null,
    "@q": context.query_path || (Array.isArray(context.inline_vector) || context.tensor_bundle_id ? "vector" : "packet")
  };
  const baseline_tokens = roughTokenEstimate(context);
  const compact_tokens = roughTokenEstimate(compact);
  return {
    context: compact,
    baseline_tokens,
    compact_tokens,
    reduction: baseline_tokens ? 1 - compact_tokens / baseline_tokens : 0
  };
}

export function assertThalamusRouted(spawnContext = {}) {
  const context = spawnContext.context && typeof spawnContext.context === "object" ? spawnContext.context : spawnContext;
  const packetId = context.packet_id || context.thalamus_packet_id || context["@p"];
  const resolverKey = context.resolver_key || context.thalamus_resolver_key || context["@r"];
  if (!packetId || !resolverKey) {
    const error = new Error("thalamus_required: spawn context must include packet_id and resolver_key");
    error.code = "thalamus_required";
    error.context = { has_packet_id: Boolean(packetId), has_resolver_key: Boolean(resolverKey) };
    throw error;
  }
  return {
    ok: true,
    packet_id: packetId,
    resolver_key: resolverKey,
    inline_vector_present: Array.isArray(context.inline_vector) && context.inline_vector.length === 512,
    tensor_bundle_present: Boolean(context.tensor_bundle_id || context["@tb"]),
    protocol_version: context.protocol_version || ALCYONE_PROTOCOL_VERSION,
    protocol_ack: context.ack || protocolAck()
  };
}

export async function recordThalamusTelemetry(event = {}) {
  const tokenContext = event.spawn_context || event.context || {
    agent: event.agent || "captain",
    packet_id: event.packet_id || null,
    resolver_key: event.resolver_key || null,
    inline_vector_present: Boolean(event.inline_vector_present),
    tensor_bundle_present: Boolean(event.tensor_bundle_present),
    vector_query_present: Boolean(event.vector_query_present),
    source: event.source || "thalamus"
  };
  const compact = compactSpawnContext(tokenContext);
  const spawnContextTokens = Number(event.spawn_context_tokens || compact.baseline_tokens || 0);
  const compactContextTokens = Number(event.compact_context_tokens || compact.compact_tokens || 0);
  const tokenReduction = Number(
    event.token_reduction ?? (spawnContextTokens ? 1 - compactContextTokens / spawnContextTokens : 0)
  );
  const row = {
    ts: new Date().toISOString(),
    run_id: event.run_id || event.runId || event.packet_id || null,
    agent: event.agent || "captain",
    thalamus_used: Boolean(event.thalamus_used ?? event.packet_id),
    vector_query_present: Boolean(event.vector_query_present),
    packet_count: Number(event.packet_count || 0),
    packet_id: event.packet_id || null,
    resolver_key_present: Boolean(event.resolver_key),
    inline_vector_present: Boolean(event.inline_vector_present),
    tensor_bundle_present: Boolean(event.tensor_bundle_present),
    protocol_version: event.protocol_version || ALCYONE_PROTOCOL_VERSION,
    protocol_ack: event.protocol_ack || event.ack || protocolAck(),
    spawn_context_tokens: spawnContextTokens,
    compact_context_tokens: compactContextTokens,
    token_reduction: tokenReduction,
    escalate_status: event.escalate_status || "none",
    rejection_count: Number(event.rejection_count || 0),
    escalated_to_mami: Boolean(event.escalated_to_mami),
    error_code: event.error_code || null,
    source: event.source || "thalamus"
  };
  await appendJsonl(RUN_TELEMETRY_PATH, row);
  return row;
}

export async function readLastTelemetry(n = 10) {
  try {
    const raw = await fs.readFile(RUN_TELEMETRY_PATH, "utf8");
    const rows = raw.trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(100, Number(n) || 10)))
      .map((line) => JSON.parse(line));
    return { ok: true, path: RUN_TELEMETRY_PATH, count: rows.length, rows };
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: true, path: RUN_TELEMETRY_PATH, count: 0, rows: [] };
    return { ok: false, path: RUN_TELEMETRY_PATH, error: err.message || String(err), rows: [] };
  }
}

export async function validateSpawnContextFile(file) {
  const value = await readJsonSafe(file, null);
  if (!value) throw new Error(`invalid JSON context file: ${file}`);
  return assertThalamusRouted(value);
}
