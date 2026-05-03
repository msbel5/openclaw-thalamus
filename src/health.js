import fs from "node:fs/promises";
import path from "node:path";
import {
  HAILO_BENCHMARK_HEF,
  HOME,
  OPENCLAW_BIN,
  OPENCLAW_JSON,
  PROJECT_ROOT,
  SGA_ATOMS_DB,
  SGA_DIR,
  SGA_PYTHON
} from "./config.js";
import { readJsonSafe, redact, runFile } from "./system.js";
import { getLocalLlmStatus } from "./local_llm.js";
import { getPacketStats } from "./packet_store.js";
import { getVectorStats } from "./vector_store.js";

function parseHailoIdentify(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) out[match[1].trim()] = match[2].trim();
  }
  return {
    architecture: out["Device Architecture"] || null,
    firmware: out["Firmware Version"] || null,
    control_protocol: out["Control Protocol Version"] || null,
    board_sku: out["board SKU-ID"] || null,
    supported_features: out["Device supported features"] || null
  };
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function getHailoHealth() {
  const scan = await runFile("hailortcli", ["scan"], { timeout: 10_000 });
  const identify = await runFile("hailortcli", ["fw-control", "identify", "--extended"], {
    timeout: 15_000
  });
  const lspci = await runFile("lspci", ["-nn"], { timeout: 10_000 });
  const devExists = await pathExists("/dev/hailo0");
  return {
    ok: scan.ok && identify.ok && devExists,
    device_present: /Device:/.test(scan.stdout),
    dev_node: devExists ? "/dev/hailo0" : null,
    scan: redact(scan.stdout || scan.stderr),
    identify: parseHailoIdentify(identify.stdout),
    lspci_hailo: (lspci.stdout || "")
      .split(/\r?\n/)
      .filter((line) => /hailo/i.test(line))
      .join("\n"),
    benchmark_hef: HAILO_BENCHMARK_HEF,
    timings_ms: { scan: scan.ms, identify: identify.ms }
  };
}

async function getServiceState(name) {
  const active = await runFile("systemctl", ["--user", "is-active", name], { timeout: 10_000 });
  const show = await runFile(
    "systemctl",
    ["--user", "show", name, "--property=MainPID,ActiveState,SubState,CPUUsageNSec"],
    { timeout: 10_000 }
  );
  const props = {};
  for (const line of show.stdout.split(/\r?\n/)) {
    const [key, value] = line.split("=", 2);
    if (key) props[key] = value || "";
  }
  let fallback = null;
  if (active.stdout !== "active") {
    const pattern =
      name === "openclaw-gateway.service"
        ? "openclaw.*gateway --port 18789"
        : name === "trading-bot.service"
          ? "workspace/trading/bot.py"
          : name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pgrep = await runFile("pgrep", ["-af", pattern], { timeout: 10_000 });
    if (pgrep.ok && pgrep.stdout) {
      fallback = pgrep.stdout.split(/\r?\n/)[0];
    }
  }
  return {
    service: name,
    active: active.stdout || (fallback ? "active-by-process" : "unknown"),
    ok: active.stdout === "active" || Boolean(fallback),
    fallback_process: fallback,
    props
  };
}

async function getOpenClawHealth() {
  const cfg = await readJsonSafe(OPENCLAW_JSON, {});
  const version = await runFile(OPENCLAW_BIN, ["--version"], { timeout: 20_000 });
  const mcpList = await runFile(OPENCLAW_BIN, ["mcp", "list"], { timeout: 30_000 });
  const gateway = await getServiceState("openclaw-gateway.service");
  return {
    ok: gateway.ok && Boolean(cfg.agents),
    version: redact(version.stdout || version.stderr),
    gateway,
    config_path: OPENCLAW_JSON,
    agents: (cfg.agents?.list || []).map((agent) => ({
      id: agent.id,
      model: agent.model || null,
      subagents: agent.subagents
        ? {
            allowAgents: agent.subagents.allowAgents || [],
            model: agent.subagents.model || null,
            thinking: agent.subagents.thinking || null
          }
        : null
    })),
    default_model: cfg.agents?.defaults?.model || null,
    mcp_servers: Object.keys(cfg.mcp?.servers || {}).sort(),
    mcp_list: redact(mcpList.stdout || mcpList.stderr),
    plugins_allow: cfg.plugins?.allow || [],
    plugin_entries: Object.keys(cfg.plugins?.entries || {}).sort()
  };
}

async function getAtomStats() {
  const helper = path.join(PROJECT_ROOT, "scripts", "list_atoms.py");
  const python = (await pathExists(SGA_PYTHON)) ? SGA_PYTHON : "python3";
  const result = await runFile(python, [helper, "--stats"], { timeout: 20_000 });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = { ok: false, error: result.stderr || result.stdout || "stats parse failed" };
  }
  return {
    ok: Boolean(parsed?.ok),
    sga_dir: SGA_DIR,
    lancedb_path: SGA_ATOMS_DB,
    python,
    ...parsed
  };
}

async function getDiskHealth() {
  const homeDf = await runFile("df", ["-h", HOME], { timeout: 10_000 });
  const openclawDu = await runFile("du", ["-sh", path.join(HOME, ".openclaw")], { timeout: 20_000 });
  return {
    ok: homeDf.ok,
    df_home: homeDf.stdout,
    openclaw_size: openclawDu.stdout
  };
}

async function getHailoPackages() {
  const dpkg = await runFile("dpkg-query", ["-W", "-f=${Package} ${Version} ${Status}\n"], {
    timeout: 20_000
  });
  const packages = (dpkg.stdout || "")
    .split(/\r?\n/)
    .filter((line) => /hailo/i.test(line))
    .sort();
  return { ok: dpkg.ok, packages };
}

export async function getHealth() {
  const [hailo, local_llm, openclaw, trading, atoms, disk, packages, packets, vectors] = await Promise.all([
    getHailoHealth(),
    getLocalLlmStatus(),
    getOpenClawHealth(),
    getServiceState("trading-bot.service"),
    getAtomStats(),
    getDiskHealth(),
    getHailoPackages(),
    getPacketStats(),
    getVectorStats()
  ]);
  return {
    generated_at: new Date().toISOString(),
    hostname: (await runFile("hostname", [], { timeout: 5_000 })).stdout,
    status: {
      ok: hailo.ok && openclaw.ok && trading.ok,
      hailo: hailo.ok,
      local_llm: local_llm.ok && local_llm.default_model_available,
      openclaw: openclaw.ok,
      trading_bot: trading.ok,
      atom_memory: atoms.ok,
      packet_store: packets.ok,
      vector_store: vectors.ok
    },
    hailo,
    local_llm,
    openclaw,
    trading_bot: trading,
    atom_memory: atoms,
    packet_store: packets,
    vector_store: vectors,
    disk,
    packages
  };
}
