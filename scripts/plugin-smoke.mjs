#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import plugin from "../dist/plugin.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "thalamus-plugin-smoke-"));
const tools = new Map();
const hooks = new Map();

const api = {
  id: "thalamus",
  name: "Thalamus",
  version: "0.2.0",
  description: "Smoke test",
  source: "smoke",
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
  resolvePath(input) {
    return path.resolve(process.cwd(), input);
  },
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  on(name, handler) {
    hooks.set(name, handler);
  },
};

try {
  plugin.register(api);

  for (const name of ["thalamus_encode", "thalamus_route", "thalamus_recall"]) {
    if (!tools.has(name)) {
      throw new Error(`missing tool: ${name}`);
    }
  }

  const encoded = payloadOf(
    await tools.get("thalamus_encode").execute("smoke-encode", {
      modality: "text",
      text: "Pi 5 smoke test packet",
      priority: 1,
    }),
  );
  const routed = payloadOf(
    await tools.get("thalamus_route").execute("smoke-route", {}),
  );
  const recalled = payloadOf(
    await tools.get("thalamus_recall").execute("smoke-recall", {
      text_query: "smoke test",
      k: 1,
    }),
  );

  if (encoded.packet_id !== routed.packet_id) {
    throw new Error(
      `route mismatch: encoded=${encoded.packet_id} routed=${routed.packet_id}`,
    );
  }

  if (recalled.hits?.[0]?.packet_id !== encoded.packet_id) {
    throw new Error(
      `recall mismatch: encoded=${encoded.packet_id} recalled=${recalled.hits?.[0]?.packet_id}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tools: Array.from(tools.keys()).sort(),
        packet_id: encoded.packet_id,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function payloadOf(result) {
  if (result && typeof result === "object" && "details" in result) {
    return result.details;
  }

  throw new Error("tool result did not include details");
}
