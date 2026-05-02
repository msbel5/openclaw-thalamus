import fs from "node:fs/promises";
import path from "node:path";
import { BENCHMARK_TASKS, HAILO_BENCHMARK_HEF, REPORT_DIR, STATE_DIR } from "./config.js";
import { buildContextPacket } from "./context.js";
import { appendJsonl, ensureDirs, runFile, writeJson } from "./system.js";

function parseBenchmark(stdout) {
  const text = stdout || "";
  const fps = text.match(/FPS:\s*([0-9.]+)/i)?.[1];
  const avg = text.match(/Average FPS:\s*([0-9.]+)/i)?.[1];
  const tempMean =
    text.match(/Mean:\s*([0-9.]+)/i)?.[1] ||
    text.match(/mean\s*=\s*([0-9.]+)/i)?.[1] ||
    text.match(/mean\s+([0-9.]+)/i)?.[1];
  return {
    fps: fps ? Number(fps) : avg ? Number(avg) : null,
    temp_mean_c: tempMean ? Number(tempMean) : null,
    raw_tail: text.split(/\r?\n/).slice(-30).join("\n")
  };
}

export async function runHailoBenchmark(options = {}) {
  const hef = options.hef || HAILO_BENCHMARK_HEF;
  try {
    await fs.access(hef);
  } catch {
    return { ok: false, skipped: true, reason: `HEF not found: ${hef}` };
  }
  const seconds = String(options.seconds || 5);
  const result = await runFile("hailortcli", ["benchmark", hef, "-t", seconds, "--batch-size", "1"], {
    timeout: (Number(seconds) + 20) * 1000
  });
  return {
    ok: result.ok,
    hef,
    seconds: Number(seconds),
    ...parseBenchmark(result.stdout),
    stderr: result.stderr,
    ms: result.ms
  };
}

export async function runContextBenchmark(options = {}) {
  const tasks = options.tasks || BENCHMARK_TASKS;
  const results = [];
  for (const task of tasks) {
    const started = Date.now();
    const packet = await buildContextPacket(task, {
      topK: options.topK || 5,
      budgetTokens: options.budgetTokens || 4000,
      noRemote: options.noRemote || false
    });
    results.push({
      task,
      packet_id: packet.packet_id,
      atoms: packet.atoms.length,
      confidence: packet.confidence,
      packet_tokens: packet.token_estimate.packet_tokens,
      baseline_context_tokens: packet.token_estimate.baseline_context_tokens,
      estimated_savings_tokens: packet.token_estimate.estimated_savings_tokens,
      ms: Date.now() - started,
      retrieval_mode: packet.proof.find((p) => p.type === "atom_memory")?.evidence?.retrieval_mode
    });
  }
  const avg = (field) =>
    results.length ? Math.round(results.reduce((sum, row) => sum + (row[field] || 0), 0) / results.length) : 0;
  return {
    ok: true,
    task_count: results.length,
    averages: {
      packet_tokens: avg("packet_tokens"),
      baseline_context_tokens: avg("baseline_context_tokens"),
      estimated_savings_tokens: avg("estimated_savings_tokens"),
      ms: avg("ms")
    },
    results
  };
}

export async function runBenchmark(options = {}) {
  await ensureDirs();
  const [hailo, context] = await Promise.all([
    options.runHailo ? runHailoBenchmark(options) : Promise.resolve({ ok: true, skipped: true }),
    runContextBenchmark(options)
  ]);
  const report = {
    generated_at: new Date().toISOString(),
    hailo,
    context
  };
  const stamp = report.generated_at.replace(/[-:.TZ]/g, "").slice(0, 14);
  await writeJson(path.join(REPORT_DIR, `benchmark-${stamp}.json`), report);
  await writeJson(path.join(STATE_DIR, "latest_benchmark.json"), report);
  await appendJsonl(path.join(STATE_DIR, "tool_calls.jsonl"), {
    ts: report.generated_at,
    tool: "thalamus_benchmark",
    run_hailo: Boolean(options.runHailo),
    task_count: context.task_count,
    hailo_fps: hailo.fps || null
  });
  return report;
}
