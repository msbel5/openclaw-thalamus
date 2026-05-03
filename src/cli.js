#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runBenchmark } from "./benchmark.js";
import { buildContextPacket } from "./context.js";
import { HOME, OPENCLAW_BIN, PROJECT_ROOT, REPORT_DIR, STATE_DIR } from "./config.js";
import { getHealth } from "./health.js";
import { ingest } from "./ingest.js";
import { runLocalInference } from "./local_llm.js";
import { cleanupPackets } from "./packet_store.js";
import { resolveRoute, routeTask } from "./router.js";
import { ensureDirs, writeJson } from "./system.js";
import { cluster, compare, embed, initNamespaces, search } from "./vector_store.js";


const execFileAsync = promisify(execFile);

async function readJsonOrNull(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readTextOrEmpty(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function tailLines(text, count) {
  return String(text || "").trim().split(/\r?\n/).filter(Boolean).slice(-count);
}

async function runFileSafe(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      timeout: options.timeout || 5000,
      maxBuffer: options.maxBuffer || 128_000,
      cwd: options.cwd || PROJECT_ROOT
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || error.message || error).trim()
    };
  }
}

async function collectHeartbeatMeasurements() {
  const tradingLogDir = path.join(HOME, ".openclaw", "workspace", "trading", "logs");
  const dashboard = await readJsonOrNull(path.join(tradingLogDir, "dashboard_state.json"));
  const botLog = await readTextOrEmpty(path.join(tradingLogDir, "bot_v2.log"));
  const tempRaw = await readTextOrEmpty("/sys/class/thermal/thermal_zone0/temp");
  const meminfo = await readTextOrEmpty("/proc/meminfo");
  const tempC = Number(tempRaw.trim()) / 1000;
  const memMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  const memAvailableMb = memMatch ? Math.round(Number(memMatch[1]) / 1024) : null;
  const services = {};
  for (const service of ["trading-bot", "ember-backend", "hailo-ollama", "openclaw-gateway", "thalamus-dashboard", "thalamus-encoder"]) {
    const r = await runFileSafe("systemctl", ["--user", "is-active", service], { timeout: 2500 });
    services[service] = (r.stdout || r.stderr || "unknown").trim();
  }
  const git = await runFileSafe("git", ["-C", path.join(HOME, "projects-alcyone", "alcyone-ember-rpg"), "log", "--oneline", "--since=1.hour.ago", "-3"], { timeout: 3000 });
  const session = await runFileSafe("bash", ["-lc", "ls -t ~/.openclaw/agents/captain/sessions/*.jsonl 2>/dev/null | head -1 | xargs -r stat -c %y"], { timeout: 3000 });
  const positions = Object.entries(dashboard?.positions || {})
    .filter(([, value]) => Number(value?.amount || 0) !== 0)
    .map(([symbol, value]) => `${symbol} amt=${Number(value.amount).toFixed(4)} pnl=${Number(value.pnl_pct || 0).toFixed(3)}%`);
  return {
    dashboard_ok: Boolean(dashboard),
    last_update: dashboard?.last_update || null,
    total_pnl: dashboard?.total_pnl ?? null,
    daily_pnl: dashboard?.daily_pnl ?? null,
    uptime: dashboard?.uptime || null,
    regime: dashboard?.regime || null,
    models_active: dashboard?.models_active ?? null,
    positions,
    bot_tail: tailLines(botLog, 3),
    temp_c: Number.isFinite(tempC) ? Number(tempC.toFixed(1)) : null,
    mem_available_mb: memAvailableMb,
    services,
    ember_recent: git.stdout || "no commits in last hour",
    captain_session_mtime: session.stdout || null
  };
}

function buildHeartbeatMessage(measurements, local) {
  const positions = measurements.positions.length ? measurements.positions.join("; ") : "open position yok";
  const serviceText = Object.entries(measurements.services).map(([k, v]) => `${k}=${v}`).join(", ");
  const botTail = measurements.bot_tail.join(" | ") || "bot log yok";
  return [
    "CANARY heartbeat (ölçümlü)",
    `dashboard=${measurements.dashboard_ok ? "ok" : "missing"} last=${measurements.last_update || "n/a"}`,
    `trading total_pnl=${measurements.total_pnl ?? "n/a"} daily_pnl=${measurements.daily_pnl ?? "n/a"} uptime=${measurements.uptime || "n/a"}`,
    `positions: ${positions}`,
    `pi temp=${measurements.temp_c ?? "n/a"}C mem=${measurements.mem_available_mb ?? "n/a"}MB`,
    `services: ${serviceText}`,
    `bot: ${botTail}`,
    `ember: ${measurements.ember_recent}`,
    `captain_session=${measurements.captain_session_mtime || "n/a"}`,
    `hailo model=${local.model || "n/a"} provider=${local.provider || "n/a"} latency=${local.latency_ms ?? "n/a"}ms ok=${local.ok}`
  ].join("\n");
}

async function sendTelegramViaOpenClaw(message, chatId) {
  const result = await runFileSafe(OPENCLAW_BIN, ["message", "send", "--channel", "telegram", "--target", chatId, "--message", message, "--json"], {
    timeout: 30_000,
    maxBuffer: 256_000
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch {}
  return { ...result, json: parsed };
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argAfter(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function positionalArgs(start = 3) {
  const out = [];
  for (let i = start; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) i += 1;
    } else {
      out.push(arg);
    }
  }
  return out;
}

async function inventory() {
  await ensureDirs();
  const health = await getHealth();
  const stamp = health.generated_at.replace(/[-:.TZ]/g, "").slice(0, 14);
  const file = path.join(REPORT_DIR, `inventory-${stamp}.json`);
  await writeJson(file, health);
  console.log(JSON.stringify({ ok: true, file, status: health.status }, null, 2));
}

async function printLatest() {
  const files = ["latest_packet.json", "latest_benchmark.json"];
  const out = {};
  for (const file of files) {
    try {
      out[file] = JSON.parse(await fs.readFile(path.join(STATE_DIR, file), "utf8"));
    } catch {
      out[file] = null;
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const command = process.argv[2] || "help";
  if (command === "health") {
    const health = await getHealth();
    await ensureDirs();
    await writeJson(path.join(STATE_DIR, "latest_health.json"), health);
    console.log(JSON.stringify(health, null, 2));
    return;
  }
  if (command === "context") {
    const task = positionalArgs().join(" ");
    if (!task) throw new Error('Usage: node src/cli.js context "task summary"');
    const packet = await buildContextPacket(task, {
      noRemote: hasFlag("--no-remote"),
      topK: Number(argAfter("--top", "5")),
      budgetTokens: Number(argAfter("--budget", "4000"))
    });
    console.log(JSON.stringify(packet, null, 2));
    return;
  }
  if (command === "route") {
    const task = positionalArgs().join(" ");
    if (!task) throw new Error('Usage: node src/cli.js route "task summary"');
    const routed = await routeTask({
      task,
      noCache: hasFlag("--no-cache"),
      topK: Number(argAfter("--top", "5")),
      budgetTokens: Number(argAfter("--budget", "4000")),
      category_filter: argAfter("--namespace") ? [argAfter("--namespace")] : undefined
    });
    console.log(JSON.stringify(routed, null, 2));
    return;
  }
  if (command === "resolve") {
    const packetId = argAfter("--packet") || process.argv[3];
    const resolverKey = argAfter("--key") || process.argv[4];
    console.log(JSON.stringify(await resolveRoute({ packet_id: packetId, resolver_key: resolverKey }), null, 2));
    return;
  }
  if (command === "embed") {
    const text = argAfter("--text") || positionalArgs().join(" ");
    const result = await embed({
      text,
      audio_path: argAfter("--audio"),
      image_path: argAfter("--image"),
      namespace: argAfter("--namespace", "atoms.memory"),
      store: hasFlag("--store")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "ingest") {
    const text = argAfter("--text") || positionalArgs().join(" ");
    const result = await ingest({
      text: text || undefined,
      audio_path: argAfter("--audio"),
      image_path: argAfter("--image"),
      video_path: argAfter("--video"),
      source: argAfter("--source", "cli"),
      intent: argAfter("--intent", "manual-ingest"),
      metadata: argAfter("--metadata") ? JSON.parse(argAfter("--metadata")) : {}
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "search") {
    const text = argAfter("--text") || positionalArgs().join(" ");
    const result = await search({
      text,
      namespace: argAfter("--namespace", "atoms.memory"),
      k: Number(argAfter("--top", "5")),
      threshold: Number(argAfter("--threshold", "0"))
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "init-namespaces") {
    console.log(JSON.stringify(await initNamespaces({ migrate: !hasFlag("--no-migrate") }), null, 2));
    return;
  }
  if (command === "heartbeat-canary") {
    const started = Date.now();
    const measurements = await collectHeartbeatMeasurements();
    const local = await runLocalInference({
      prompt: "Sadece CANARY_OK yaz. Ölçüm raporunu sistem deterministik oluşturacak; uydurma yapma.",
      max_tokens: 8,
      temperature: 0,
      keep_alive: argAfter("--keep-alive", "0s"),
      timeout_ms: 30_000
    });
    const message = buildHeartbeatMessage(measurements, local);
    let send = null;
    if (hasFlag("--send")) {
      send = await sendTelegramViaOpenClaw(message, argAfter("--chat", "1087797886"));
    }
    console.log(JSON.stringify({
      ok: Boolean(measurements.dashboard_ok && local.ok && (!hasFlag("--send") || send?.ok)),
      sent: Boolean(hasFlag("--send") && send?.ok),
      provider: local.provider || "hailo-ollama",
      model: local.model,
      keep_alive: local.keep_alive,
      unload: local.unload,
      on_device: local.on_device,
      latency_ms: Date.now() - started,
      measurements,
      text: message,
      send: send ? { ok: send.ok, stdout: send.stdout, stderr: send.stderr, json: send.json } : null,
      error: local.error || (send && !send.ok ? send.stderr : null),
      note: hasFlag("--send") ? "Telegram send requested explicitly." : "Dry canary: no Telegram send without --send."
    }, null, 2));
    return;
  }
  if (command === "compare") {
    const a = JSON.parse(argAfter("--a", "[]"));
    const b = JSON.parse(argAfter("--b", "[]"));
    console.log(JSON.stringify(await compare({ vec_a: a, vec_b: b }), null, 2));
    return;
  }
  if (command === "cluster") {
    console.log(JSON.stringify(await cluster({ threshold: Number(argAfter("--threshold", "0.85")) }), null, 2));
    return;
  }
  if (command === "packet-cleanup") {
    console.log(JSON.stringify(await cleanupPackets(), null, 2));
    return;
  }
  if (command === "benchmark") {
    const report = await runBenchmark({
      runHailo: hasFlag("--run-hailo"),
      noRemote: hasFlag("--no-remote"),
      topK: Number(argAfter("--top", "5"))
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "inventory") {
    await inventory();
    return;
  }
  if (command === "latest") {
    await printLatest();
    return;
  }
  console.log(`openclaw-thalamus v0.2

Usage:
  node src/cli.js health
  node src/cli.js route "task summary" [--no-cache] [--namespace atoms.code]
  node src/cli.js resolve --packet pkt_... --key sha256:...
  node src/cli.js embed "text" [--store] [--audio path] [--image path] [--namespace atoms.memory]
  node src/cli.js ingest [--text "text"] [--audio path] [--image path] [--video path] [--source cli] [--intent reference]
  node src/cli.js search "text" --namespace atoms.memory [--top 5] [--threshold 0.85]
  node src/cli.js init-namespaces [--no-migrate]
  node src/cli.js heartbeat-canary [--send] [--chat 1087797886] [--keep-alive 0s]
  node src/cli.js compare --a "[...]" --b "[...]"
  node src/cli.js cluster [--threshold 0.85]
  node src/cli.js context "task summary" [--no-remote] [--top 5] [--budget 4000]
  node src/cli.js benchmark [--run-hailo] [--no-remote]
  node src/cli.js packet-cleanup
  node src/cli.js inventory
  node src/cli.js latest
`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
