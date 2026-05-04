import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_CONTEXT_TOP_K,
  HOME,
  PROJECT_ROOT,
  SGA_PYTHON,
  STATE_DIR
} from "./config.js";
import { getHealth } from "./health.js";
import { savePacket } from "./packet_store.js";
import {
  appendJsonl,
  ensureDirs,
  fileSizeTokens,
  roughTokenEstimate,
  runFile,
  stableId,
  writeJson
} from "./system.js";

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function retrieveAtoms(task, options = {}) {
  const topK = Number(options.topK || DEFAULT_CONTEXT_TOP_K);
  const python = (await pathExists(SGA_PYTHON)) ? SGA_PYTHON : "python3";
  const helper = path.join(PROJECT_ROOT, "scripts", "retrieve_atoms.py");
  const args = [helper, task, "--top", String(topK), "--sim-floor", String(options.simFloor ?? 0.3)];
  if (options.allowUnapproved) args.push("--allow-unapproved");
  if (options.noRemote) args.push("--no-remote");
  const result = await runFile(python, args, {
    timeout: options.timeout ?? 30_000,
    env: options.noRemote ? { THALAMUS_NO_REMOTE: "1" } : {}
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      ok: false,
      mode: "error",
      query: task,
      atoms: [],
      error: result.stderr || result.stdout || "atom retrieval parse failed"
    };
  }
}

function buildSummary(task, atoms, health) {
  const top = atoms[0];
  const source = top ? `${top.source} atom ${String(top.atom_id || "").slice(0, 8)}` : "no atom match";
  const hailo = health.status?.hailo ? "Hailo-10H online" : "Hailo not healthy";
  const openclaw = health.status?.openclaw ? "OpenClaw gateway online" : "OpenClaw gateway unhealthy";
  return `${task.slice(0, 160)} | ${source}; ${hailo}; ${openclaw}.`;
}

function confidenceFromAtoms(atoms, health) {
  const best = atoms[0]?.similarity || 0;
  const infra = health.status?.hailo && health.status?.openclaw && health.status?.atom_memory ? 0.2 : 0;
  return Math.max(0.1, Math.min(0.95, best * 0.75 + infra));
}

function recommendedNext(task, atoms) {
  const list = [
    "Use this packet as context only; verify current files and logs before claiming work is done.",
    "Cite packet_id and atom_id when adapting an old pattern.",
    "Route coding work through Builder and require Inspector proof before memory promotion."
  ];
  if (!atoms.length) {
    list.unshift("No strong atom match; do fresh decomposition and seed a new approved atom after success.");
  } else if ((atoms[0].similarity || 0) >= 0.85) {
    list.unshift("Strong atom match; adapt the proven tool sequence, but document deviations.");
  } else {
    list.unshift("Weak/moderate atom match; use atoms as hints, not as authority.");
  }
  if (/hailo|ai hat|thalamus/i.test(task)) {
    list.push("Do not install Hailo GenAI packages without apt/dpkg dry-run proof.");
  }
  return list;
}

function proofFrom(health, atomResult, baseline) {
  const hailo = health.hailo || {};
  const openclaw = health.openclaw || {};
  return [
    {
      type: "hailo",
      source: "hailortcli scan + fw-control identify",
      ok: Boolean(health.status?.hailo),
      evidence: {
        architecture: hailo.identify?.architecture || null,
        firmware: hailo.identify?.firmware || null,
        dev_node: hailo.dev_node || null,
        timeout: Boolean(hailo.timeout)
      }
    },
    {
      type: "openclaw",
      source: "~/.openclaw/openclaw.json + systemd user service",
      ok: Boolean(health.status?.openclaw),
      evidence: {
        version: openclaw.version || null,
        gateway: openclaw.gateway?.active || null,
        agents: Array.isArray(openclaw.agents) ? openclaw.agents.map((a) => a.id) : [],
        mcp_servers: openclaw.mcp_servers || [],
        timeout: Boolean(openclaw.timeout)
      }
    },
    {
      type: "atom_memory",
      source: "~/.openclaw/lancedb/atoms",
      ok: atomResult.ok,
      evidence: {
        retrieval_mode: atomResult.mode,
        total_atoms: atomResult.count,
        returned_atoms: atomResult.atoms?.length || 0
      }
    },
    {
      type: "token_budget",
      source: "local file-size estimate",
      ok: true,
      evidence: baseline
    }
  ];
}

export async function buildContextPacket(task, options = {}) {
  await ensureDirs();
  const budgetTokens = Number(options.budgetTokens || DEFAULT_CONTEXT_BUDGET_TOKENS);
  const [health, atomResult, baseline] = await Promise.all([
    getHealth(),
    retrieveAtoms(task, options),
    fileSizeTokens([
      path.join(HOME, ".openclaw", "workspace", "AGENTS.md"),
      path.join(HOME, ".openclaw", "workspace", "SOUL.md"),
      path.join(HOME, ".openclaw", "workspace", "USER.md"),
      path.join(HOME, ".openclaw", "workspace", "CREW.md"),
      path.join(HOME, ".openclaw", "workspace", "HEARTBEAT.md"),
      path.join(HOME, ".openclaw", "workspace", "MEMORY.md")
    ])
  ]);
  const atoms = atomResult.atoms || [];
  const packet = {
    packet_id: stableId("thalamus", { task, atoms, budgetTokens }),
    generated_at: new Date().toISOString(),
    task,
    summary: buildSummary(task, atoms, health),
    atoms,
    confidence: Number(confidenceFromAtoms(atoms, health).toFixed(3)),
    recommended_next: recommendedNext(task, atoms),
    token_estimate: {
      packet_tokens: 0,
      budget_tokens: budgetTokens,
      baseline_context_tokens: baseline.tokens,
      estimated_savings_tokens: 0
    },
    proof: proofFrom(health, atomResult, baseline),
    limits: {
      no_done_claim_without_proof: true,
      approved_atoms_only: !options.allowUnapproved,
      remote_embedding_used: atomResult.mode === "vector"
    }
  };
  packet.token_estimate.packet_tokens = roughTokenEstimate(packet);
  packet.token_estimate.estimated_savings_tokens = Math.max(
    0,
    packet.token_estimate.baseline_context_tokens - packet.token_estimate.packet_tokens
  );
  if (packet.token_estimate.packet_tokens > budgetTokens) {
    packet.atoms = packet.atoms.slice(0, Math.max(1, Math.floor(packet.atoms.length / 2)));
    packet.summary = `${packet.summary} Packet trimmed to fit budget.`;
    packet.token_estimate.packet_tokens = roughTokenEstimate(packet);
  }
  const savedPacket = await savePacket(packet);
  packet.resolver_key = savedPacket.resolver_key;
  packet.expires_at = savedPacket.expires_at;
  await writeJson(path.join(STATE_DIR, "latest_packet.json"), packet);
  await appendJsonl(path.join(STATE_DIR, "tool_calls.jsonl"), {
    ts: packet.generated_at,
    tool: "thalamus_context",
    packet_id: packet.packet_id,
    task: task.slice(0, 240),
    atoms: packet.atoms.length,
    confidence: packet.confidence,
    retrieval_mode: atomResult.mode
  });
  return packet;
}
