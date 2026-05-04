import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config.js";
import { appendJsonl, readJsonSafe, writeJson } from "./system.js";
import { recordThalamusTelemetry } from "./spawn_guard.js";

export const ESCALATION_DIR = path.join(STATE_DIR, "escalations");
const MAX_REJECTIONS = 3;

function statePath(prNumber) {
  return path.join(ESCALATION_DIR, `${String(prNumber).replace(/[^0-9A-Za-z_.-]/g, "_")}.json`);
}

export async function recordRejection(input = {}) {
  await fs.mkdir(ESCALATION_DIR, { recursive: true });
  const pr = String(input.pr_number || input.pr || "unknown");
  const existing = await readJsonSafe(statePath(pr), null);
  const count = Number(existing?.rejection_count || 0) + 1;
  const row = {
    pr_number: pr,
    status: count >= MAX_REJECTIONS ? "rejected_max" : "rejected_open",
    rejection_count: count,
    verdict_file: input.verdict_file || null,
    reason: input.reason || "REJECTED",
    packet_id: input.packet_id || existing?.packet_id || null,
    resolver_key_present: Boolean(input.resolver_key || existing?.resolver_key_present),
    updated_at: new Date().toISOString(),
    created_at: existing?.created_at || new Date().toISOString(),
    max_rejections: MAX_REJECTIONS,
    telegram_chat_id: "1087797886",
    escalated_to_mami: count >= MAX_REJECTIONS
  };
  await writeJson(statePath(pr), row);
  await appendJsonl(path.join(STATE_DIR, "escalation_events.jsonl"), { ts: row.updated_at, event: "record", ...row });
  await recordThalamusTelemetry({
    source: "escalate",
    agent: "captain",
    packet_id: row.packet_id,
    thalamus_used: Boolean(row.packet_id),
    escalate_status: row.status,
    rejection_count: row.rejection_count,
    escalated_to_mami: row.escalated_to_mami
  });
  return { ok: true, state: row, path: statePath(pr) };
}

export async function getOpenRejection(prNumber) {
  const state = await readJsonSafe(statePath(prNumber), null);
  if (!state || state.status === "rejected_resolved") return { ok: true, state: null };
  return { ok: true, state, path: statePath(prNumber) };
}

export async function closeRejection(prNumber, resolution = "APPROVED") {
  const current = await readJsonSafe(statePath(prNumber), null);
  if (!current) return { ok: false, error: "not_found", pr_number: String(prNumber) };
  const state = { ...current, status: "rejected_resolved", resolution, resolved_at: new Date().toISOString() };
  await writeJson(statePath(prNumber), state);
  await appendJsonl(path.join(STATE_DIR, "escalation_events.jsonl"), { ts: state.resolved_at, event: "close", ...state });
  await recordThalamusTelemetry({
    source: "escalate",
    agent: "captain",
    packet_id: state.packet_id,
    thalamus_used: Boolean(state.packet_id),
    escalate_status: "rejected_resolved",
    rejection_count: state.rejection_count,
    escalated_to_mami: false
  });
  return { ok: true, state, path: statePath(prNumber) };
}
