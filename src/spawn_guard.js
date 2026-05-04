import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config.js";
import { appendJsonl, readJsonSafe } from "./system.js";

export const RUN_TELEMETRY_PATH = path.join(STATE_DIR, "run_telemetry.jsonl");

export function assertThalamusRouted(spawnContext = {}) {
  const context = spawnContext.context && typeof spawnContext.context === "object" ? spawnContext.context : spawnContext;
  const packetId = context.packet_id || context.thalamus_packet_id;
  const resolverKey = context.resolver_key || context.thalamus_resolver_key;
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
    tensor_bundle_present: Boolean(context.tensor_bundle_id)
  };
}

export async function recordThalamusTelemetry(event = {}) {
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
