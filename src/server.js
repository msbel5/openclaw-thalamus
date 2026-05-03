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

const server = new Server(
  {
    name: "openclaw-thalamus",
    version: "0.1.0"
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
