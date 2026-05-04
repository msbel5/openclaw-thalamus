import path from "node:path";
import { buildContextPacket } from "./context.js";
import { AOT_EVENTS_PATH, VECTOR_NAMESPACES } from "./config.js";
import {
  cleanupPackets,
  findCachedPacket,
  makePacketId,
  resolvePacket,
  savePacket
} from "./packet_store.js";
import { appendJsonl, roughTokenEstimate } from "./system.js";
import { embed, search } from "./vector_store.js";
import { recordThalamusTelemetry } from "./spawn_guard.js";

const SIMPLE_RE = /\b(selam|merhaba|ne haber|heartbeat|status|durum|kisa|özet|ozet|ping)\b/i;
const CODE_RE = /\b(code|kod|plugin|repo|commit|test|build|fix|bug|implement|uygula)\b/i;
const AUDIT_RE = /\b(audit|review|inspect|critic|kontrol|doğrula|dogrula|approve|reject)\b/i;
const DESIGN_RE = /\b(architecture|refactor|design|plan|tasarım|tasarim|mimari|sprint)\b/i;

function chooseIntent(task, input = {}) {
  if (input.intent) return input.intent;
  const audit = AUDIT_RE.test(task);
  const code = CODE_RE.test(task);
  if (audit && !code) return "audit";
  if (/^\s*(review|audit|inspect|critic|kontrol|doğrula|dogrula)\b/i.test(task)) return "audit";
  if (CODE_RE.test(task)) return "code";
  if (DESIGN_RE.test(task)) return "architecture";
  if (SIMPLE_RE.test(task) && task.length < 400) return "simple";
  return task.length > 900 ? "architecture" : "memory";
}

function defaultNamespaces(intent, categoryFilter = []) {
  if (categoryFilter.length) return categoryFilter;
  if (intent === "code") return ["atoms.code", "atoms.plan", "atoms.memory"];
  if (intent === "audit") return ["atoms.audit", "atoms.code", "atoms.memory"];
  if (intent === "architecture") return ["atoms.plan", "atoms.code", "atoms.memory"];
  if (intent === "simple") return ["atoms.memory"];
  return ["atoms.memory", "atoms.plan"];
}

function needsAot(task, intent, confidence, input = {}) {
  const fileCount = Number(input.estimated_files || input.file_count || 0);
  const loc = Number(input.estimated_loc || input.line_count || 0);
  return (
    confidence < 0.7 ||
    fileCount >= 3 ||
    loc >= 200 ||
    ["architecture", "refactor", "design"].includes(intent)
  );
}

function routeFor(intent, confidence) {
  if (intent === "simple") {
    return {
      target: "local",
      provider: "thalamus",
      model: "qwen2.5-via-local-inference",
      escalation_reason: "simple/local task; Hailo qwen2.5 is preferred before premium models"
    };
  }
  if (intent === "audit") {
    return {
      target: "inspector",
      provider: "anthropic",
      model: "claude-opus-4-7",
      escalation_reason: "critic/audit work needs Inspector-quality frontier review"
    };
  }
  if (intent === "code") {
    return {
      target: "builder",
      provider: "openai-codex",
      model: "gpt-5.5",
      escalation_reason: confidence >= 0.85
        ? "strong atom pattern exists; Builder should adapt with cited atom_id"
        : "code task requires Builder and tests after Thalamus context"
    };
  }
  return {
    target: "captain",
    provider: "openai-codex",
    model: "gpt-5.5",
    escalation_reason: "complex planning/design task requires Captain decomposition"
  };
}

function fallbackChain(intent) {
  if (intent === "simple" || intent === "memory") {
    return [
      "thalamus_local_inference/qwen2.5",
      "github-copilot/gpt-5-mini",
      "github-copilot/gpt-5.4"
    ];
  }
  if (intent === "audit") {
    return [
      "anthropic/claude-opus-4-7",
      "github-copilot/claude-opus-4.6",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash"
    ];
  }
  return [
    "openai-codex/gpt-5.5:auth_order",
    "github-copilot/gpt-5.4",
    "github-copilot/claude-opus-4.6",
    "anthropic/claude-opus-4-7",
    "google/gemini-2.5-pro"
  ];
}

export function aotCallTemplate(packetId, task, topic = task) {
  return [
    {
      tool: "atomcommands",
      input: { command: "new_session", sessionId: packetId, task, maxAtoms: 5 }
    },
    {
      tool: "AoT-full",
      repeat: "3-7",
      input: { sessionId: packetId, topic }
    },
    {
      tool: "atomcommands",
      input: { command: "best_conclusion", sessionId: packetId }
    },
    {
      tool: "atomcommands",
      input: { command: "export", sessionId: packetId }
    }
  ];
}

export async function routeTask(input = {}) {
  await cleanupPackets();
  const task = String(input.task || "").trim();
  if (!task) return { ok: false, error: "thalamus_route requires task" };
  const cachedPacket = await findCachedPacket(task);
  if (cachedPacket && !input.noCache) {
    await recordThalamusTelemetry({
      source: "thalamus_route_cached",
      agent: input.agent || "captain",
      packet_id: cachedPacket.packet_id,
      resolver_key: cachedPacket.resolver_key,
      thalamus_used: true,
      vector_query_present: Boolean(cachedPacket.vector_query),
      inline_vector_present: Boolean(cachedPacket.vector_query?.normalized_512),
      packet_count: 1
    });
    return {
      ok: true,
      cached: true,
      thalamus_packet_id: cachedPacket.packet_id,
      thalamus_resolver_key: cachedPacket.resolver_key,
      packet_id: cachedPacket.packet_id,
      resolver_key: cachedPacket.resolver_key,
      confidence: cachedPacket.route?.confidence || cachedPacket.confidence || 0.5,
      escalation_reason: cachedPacket.route?.escalation_reason || "cached prior route",
      route: cachedPacket.route,
      packet: cachedPacket
    };
  }

  const intent = chooseIntent(task, input);
  const namespaces = defaultNamespaces(intent, input.category_filter || input.categoryFilter || []);
  const embedding = await embed({ text: task, namespace: namespaces[0] || "atoms.memory", store: Boolean(input.store_query) });
  const query = embedding.embeddings.find((row) => row.namespace === namespaces[0]) || embedding.embeddings[0];
  const searches = [];
  for (const namespace of namespaces.filter((ns) => VECTOR_NAMESPACES[ns])) {
    searches.push(
      await search({
        vector: query.normalized_512,
        source_namespace: query.namespace,
        namespace,
        k: input.k || input.topK || 5,
        threshold: Number(input.threshold ?? 0)
      })
    );
  }
  const bestSimilarity = Math.max(
    0,
    ...searches.flatMap((result) => (result.matches || []).map((row) => row.similarity || 0))
  );
  const context = await buildContextPacket(task, {
    topK: Number(input.topK || 5),
    budgetTokens: Number(input.budgetTokens || 4000),
    noRemote: input.noRemote !== false,
    category_filter: namespaces
  });
  const contextBest = Math.max(0, ...((context.atoms || []).map((atom) => atom.similarity || 0)));
  const confidence = Number(Math.max(0.35, Math.min(0.96, bestSimilarity * 0.55 + contextBest * 0.25 + context.confidence * 0.2)).toFixed(3));
  const selected = routeFor(intent, confidence);
  const aotRequired = needsAot(task, intent, confidence, input);
  const packetId = makePacketId(task, `${intent}:${namespaces.join(",")}`);
  const route = {
    intent,
    target: selected.target,
    provider: selected.provider,
    model: selected.model,
    confidence,
    escalation_reason: selected.escalation_reason,
    cached: false,
    aot_required: aotRequired,
    aot_trigger_rule:
      "AoT only when confidence <0.7, task >=3 files, task >=200 LOC, or intent is architecture/refactor/design",
    category_filter: namespaces,
    fallback_chain: fallbackChain(intent),
    vector_policy: {
      query_dim: query?.vector_dim || null,
      normalized_dim: 512,
      namespaces,
      thresholds: Object.fromEntries(namespaces.map((ns) => [ns, VECTOR_NAMESPACES[ns]?.threshold || 0.85]))
    }
  };
  const packet = await savePacket({
    packet_id: packetId,
    generated_at: new Date().toISOString(),
    task,
    route,
    summary: `${intent} -> ${selected.target}; confidence ${confidence}; ${selected.escalation_reason}`,
    context_packet_id: context.packet_id,
    context_resolver_key: context.resolver_key,
    vector_query: {
      embedding_id: embedding.embedding_id,
      namespace: query?.namespace,
      vector_dim: query?.vector_dim,
      normalized_512: query?.normalized_512,
      degraded: embedding.degraded
    },
    searches,
    atoms: context.atoms || [],
    recommended_next: [
      "Pass thalamus_packet_id and thalamus_resolver_key in sessions_spawn input.context.",
      "Use thalamus_resolve before relying on a packet.",
      "Use thalamus_search with agent-generated vectors before creating or reviewing durable work."
    ],
    aot: aotRequired
      ? {
          required: true,
          events_path: AOT_EVENTS_PATH,
          call_template: aotCallTemplate(packetId, task)
        }
      : { required: false },
    confidence,
    token_estimate: {
      packet_tokens: 0,
      context_tokens: context.token_estimate?.packet_tokens || null
    },
    proof: [
      ...(context.proof || []),
      {
        type: "vector_route",
        ok: true,
        source: "thalamus_embed + thalamus_search",
        evidence: {
          namespaces,
          best_similarity: bestSimilarity,
          embedding_degraded: embedding.degraded
        }
      }
    ]
  });
  packet.token_estimate.packet_tokens = roughTokenEstimate(packet);
  await recordThalamusTelemetry({
    source: "thalamus_route_new",
    agent: input.agent || "captain",
    run_id: input.run_id || packet.packet_id,
    packet_id: packet.packet_id,
    resolver_key: packet.resolver_key,
    thalamus_used: true,
    vector_query_present: Boolean(packet.vector_query),
    inline_vector_present: Boolean(query?.normalized_512),
    packet_count: 1
  });
  await appendJsonl(path.join(path.dirname(AOT_EVENTS_PATH), "route_events.jsonl"), {
    ts: packet.generated_at,
    tool: "thalamus_route",
    packet_id: packet.packet_id,
    resolver_key: packet.resolver_key,
    inline_vector: query?.normalized_512,
    inline_vector_dim: 512,
    inline_vector_namespace: query?.namespace,
    inline_vector_model: query?.model,
    intent,
    target: route.target,
    confidence,
    aot_required: aotRequired
  });
  return {
    ok: true,
    cached: false,
    thalamus_packet_id: packet.packet_id,
    thalamus_resolver_key: packet.resolver_key,
    packet_id: packet.packet_id,
    resolver_key: packet.resolver_key,
    inline_vector: query?.normalized_512,
    inline_vector_dim: 512,
    inline_vector_namespace: query?.namespace,
    inline_vector_model: query?.model,
    confidence,
    escalation_reason: route.escalation_reason,
    route,
    packet
  };
}

export async function resolveRoute(input = {}) {
  return resolvePacket(input.packet_id || input.thalamus_packet_id, input.resolver_key || input.thalamus_resolver_key, input);
}
