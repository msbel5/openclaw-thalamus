import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import plugin, { thalamusToolNames } from "../src/plugin.js";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(toolCallId: string, params: unknown): Promise<unknown>;
}

describe("openclaw plugin entry", () => {
  it("registers the thalamus tools", async () => {
    const { tools, cleanup } = await registerPlugin();

    try {
      expect([...tools.keys()].sort()).toEqual([...thalamusToolNames()].sort());
    } finally {
      await cleanup();
    }
  });

  it("encodes, routes, and recalls a text packet using the stub backend", async () => {
    const { tools, cleanup } = await registerPlugin();

    try {
      const encoded = payloadOf(
        await tools.get("thalamus_encode")?.execute("encode", {
          modality: "text",
          text: "Pi 5 smoke test packet",
          priority: 1,
        }),
      );
      const routed = payloadOf(
        await tools.get("thalamus_route")?.execute("route", {}),
      );
      const recalled = payloadOf(
        await tools.get("thalamus_recall")?.execute("recall", {
          text_query: "smoke test",
          k: 1,
        }),
      );
      const recalledHits = recalled.hits as
        | Array<{ packet_id?: unknown }>
        | undefined;

      expect(encoded.ok).toBe(true);
      expect(encoded.backend).toBe("stub");
      expect(routed.packet_id).toBe(encoded.packet_id);
      expect(recalledHits?.[0]?.packet_id).toBe(encoded.packet_id);
    } finally {
      await cleanup();
    }
  });
});

async function registerPlugin(): Promise<{
  tools: Map<string, RegisteredTool>;
  cleanup: () => Promise<void>;
}> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "thalamus-plugin-test-"));
  const tools = new Map<string, RegisteredTool>();
  const api = {
    id: "thalamus",
    name: "Thalamus",
    version: "0.2.0",
    description: "test",
    source: "test",
    rootDir: process.cwd(),
    pluginConfig: {
      encoderBackend: "stub",
      memorySqlitePath: ":memory:",
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    resolvePath(input: string) {
      return path.resolve(process.cwd(), input);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    on() {},
  };

  plugin.register(api);
  return {
    tools,
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  };
}

function payloadOf(result: unknown): Record<string, unknown> {
  if (result !== null && typeof result === "object" && "details" in result) {
    const details = result.details;
    if (details !== null && typeof details === "object") {
      return details as Record<string, unknown>;
    }
  }

  throw new Error("tool result did not include object details");
}
