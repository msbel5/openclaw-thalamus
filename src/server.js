#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { runBenchmark } from "./benchmark.js";
import { buildContextPacket } from "./context.js";
import { getHealth } from "./health.js";
import { runLocalInference } from "./local_llm.js";
import { resolveRoute, routeTask } from "./router.js";
import { cleanupPackets, promotePacket } from "./packet_store.js";
import { cluster, compare, embed, search } from "./vector_store.js";

const server = new Server(
  {
    name: "openclaw-thalamus",
    version: "0.2.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

const tools = [
  {
    name: "thalamus_health",
    description:
      "Read-only Alcyone health snapshot: Hailo-10H, OpenClaw gateway, trading bot state, disk, and atom memory stats.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "thalamus_route",
    description:
      "Route a task through the Thalamus cognitive hub. Returns confidence, escalation_reason, cached, thalamus_packet_id, and thalamus_resolver_key for loss-resistant handoff.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        intent: { type: "string" },
        category_filter: {
          type: "array",
          items: { type: "string" },
          description: "Optional vector namespaces such as atoms.code or atoms.audit."
        },
        topK: { type: "number", default: 5 },
        budgetTokens: { type: "number", default: 4000 },
        estimated_files: { type: "number" },
        estimated_loc: { type: "number" },
        noCache: { type: "boolean", default: false }
      }
    }
  },
  {
    name: "thalamus_resolve",
    description:
      "Resolve and verify a packet by thalamus_packet_id + thalamus_resolver_key before using delegated context.",
    inputSchema: {
      type: "object",
      required: ["packet_id", "resolver_key"],
      properties: {
        packet_id: { type: "string" },
        resolver_key: { type: "string" }
      }
    }
  },
  {
    name: "thalamus_embed",
    description:
      "Embed text/audio/image into native vectors plus normalized 512d vectors. Agents use this before vector-aware planning, code, audit, or memory writes.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        audio_path: { type: "string" },
        image_path: { type: "string" },
        namespace: { type: "string", default: "atoms.memory" },
        store: { type: "boolean", default: false }
      }
    }
  },
  {
    name: "thalamus_search",
    description:
      "Search vector store by raw vector, vector_id, or text fallback. Use raw vector for agent-to-agent handoff whenever available.",
    inputSchema: {
      type: "object",
      required: ["namespace"],
      properties: {
        vector: { type: "array", items: { type: "number" } },
        vector_id: { type: "string" },
        text: { type: "string" },
        namespace: { type: "string" },
        k: { type: "number", default: 5 },
        threshold: { type: "number" },
        source_namespace: { type: "string" }
      }
    }
  },
  {
    name: "thalamus_compare",
    description:
      "Compare two vectors with automatic 384d/512d normalization. Returns one cosine similarity score.",
    inputSchema: {
      type: "object",
      required: ["vec_a", "vec_b"],
      properties: {
        vec_a: { type: "array", items: { type: "number" } },
        vec_b: { type: "array", items: { type: "number" } },
        source_a: { type: "string" },
        source_b: { type: "string" },
        return_vectors: { type: "boolean", default: false }
      }
    }
  },
  {
    name: "thalamus_cluster",
    description:
      "Cluster stored vector IDs or all current vectors by cosine similarity. Use for packet/atom duplicate analysis.",
    inputSchema: {
      type: "object",
      properties: {
        vector_ids: { type: "array", items: { type: "string" } },
        packet_ids: { type: "array", items: { type: "string" } },
        threshold: { type: "number", default: 0.85 }
      }
    }
  },
  {
    name: "thalamus_promote_packet",
    description:
      "Promote an Inspector-approved packet so TTL cleanup will not delete it. Use only after explicit APPROVED verdict.",
    inputSchema: {
      type: "object",
      required: ["packet_id", "resolver_key"],
      properties: {
        packet_id: { type: "string" },
        resolver_key: { type: "string" },
        namespace: { type: "string" },
        lessons: { type: "string" }
      }
    }
  },
  {
    name: "thalamus_packet_cleanup",
    description:
      "Apply packet TTL and max-count rotation. Read-only for promoted packets.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "thalamus_context",
    description:
      "Build a proof-backed compact context packet from SGA atom memory and local system state. Use before planning non-trivial work.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: {
          type: "string",
          description: "One-line task or decision summary."
        },
        topK: {
          type: "number",
          description: "Maximum number of atoms to return.",
          default: 5
        },
        budgetTokens: {
          type: "number",
          description: "Target packet token budget.",
          default: 4000
        },
        noRemote: {
          type: "boolean",
          description: "Disable OpenAI embedding lookup and use lexical fallback only.",
          default: false
        }
      }
    }
  },
  {
    name: "thalamus_benchmark",
    description:
      "Run Thalamus benchmark gate. Context benchmark always runs; Hailo benchmark runs only when runHailo=true.",
    inputSchema: {
      type: "object",
      properties: {
        runHailo: {
          type: "boolean",
          default: false,
          description: "Run a short hailortcli benchmark against the configured H10 HEF."
        },
        noRemote: {
          type: "boolean",
          default: true,
          description: "Disable remote embeddings during benchmark."
        },
        topK: {
          type: "number",
          default: 5
        }
      }
    }
  },
  {
    name: "thalamus_local_inference",
    description:
      "Run a short local Hailo-10H LLM inference through the loopback hailo-ollama server. Use only for lightweight chat, memory notes, summaries, and classification.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          description: "Prompt for the local model."
        },
        model: {
          type: "string",
          description: "Optional Hailo Ollama model name.",
          default: "qwen2.5-instruct:1.5b"
        },
        max_tokens: {
          type: "number",
          default: 80
        },
        temperature: {
          type: "number",
          default: 0.2
        }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  let result;
  if (request.params.name === "thalamus_health") {
    result = await getHealth();
  } else if (request.params.name === "thalamus_context") {
    if (!args.task || typeof args.task !== "string") {
      throw new Error("thalamus_context requires string argument: task");
    }
    result = await buildContextPacket(args.task, args);
  } else if (request.params.name === "thalamus_route") {
    result = await routeTask(args);
  } else if (request.params.name === "thalamus_resolve") {
    result = await resolveRoute(args);
  } else if (request.params.name === "thalamus_embed") {
    result = await embed(args);
  } else if (request.params.name === "thalamus_search") {
    result = await search(args);
  } else if (request.params.name === "thalamus_compare") {
    result = await compare(args);
  } else if (request.params.name === "thalamus_cluster") {
    result = await cluster(args);
  } else if (request.params.name === "thalamus_promote_packet") {
    result = await promotePacket(args.packet_id, args.resolver_key, {
      namespace: args.namespace || null,
      lessons: args.lessons || null,
      approved_by: "inspector"
    });
  } else if (request.params.name === "thalamus_packet_cleanup") {
    result = await cleanupPackets();
  } else if (request.params.name === "thalamus_benchmark") {
    result = await runBenchmark({
      runHailo: Boolean(args.runHailo),
      noRemote: args.noRemote !== false,
      topK: args.topK || 5
    });
  } else if (request.params.name === "thalamus_local_inference") {
    result = await runLocalInference(args);
  } else {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
