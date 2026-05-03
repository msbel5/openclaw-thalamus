#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { runBenchmark } from "./benchmark.js";
import { buildContextPacket } from "./context.js";
import { REPORT_DIR, STATE_DIR } from "./config.js";
import { getHealth } from "./health.js";
import { cleanupPackets } from "./packet_store.js";
import { resolveRoute, routeTask } from "./router.js";
import { ensureDirs, writeJson } from "./system.js";
import { cluster, compare, embed, search } from "./vector_store.js";

function hasFlag(name) {
  return process.argv.includes(name);
}

function argAfter(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
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
    const task = process.argv.slice(3).filter((arg) => !arg.startsWith("--")).join(" ");
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
    const task = process.argv.slice(3).filter((arg) => !arg.startsWith("--")).join(" ");
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
    const text = argAfter("--text") || process.argv.slice(3).filter((arg) => !arg.startsWith("--")).join(" ");
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
  if (command === "search") {
    const text = argAfter("--text") || process.argv.slice(3).filter((arg) => !arg.startsWith("--")).join(" ");
    const result = await search({
      text,
      namespace: argAfter("--namespace", "atoms.memory"),
      k: Number(argAfter("--top", "5")),
      threshold: Number(argAfter("--threshold", "0"))
    });
    console.log(JSON.stringify(result, null, 2));
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
  node src/cli.js search "text" --namespace atoms.memory [--top 5] [--threshold 0.85]
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
