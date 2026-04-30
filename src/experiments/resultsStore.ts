import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseHandle } from "better-sqlite3";
import type { PipelineResult } from "../pipelines/types.js";

export interface RecordedMetric {
  source: string;
  expectedAnswer: string;
  fidelity: number;
  taskSuccess: boolean;
}

export interface PipelineSummary {
  pipeline: string;
  count: number;
  latency_median_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  avg_tokens: number;
  avg_fidelity: number;
  task_success_rate: number;
}

interface RunRow {
  pipeline: string;
  latency_ms: number;
  token_count: number;
  fidelity: number;
  task_success: number;
}

export class ResultsStore {
  private readonly db: DatabaseHandle;

  constructor(
    readonly sqlitePath = path.resolve(
      process.cwd(),
      "experiments/results.sqlite",
    ),
  ) {
    mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.init();
  }

  reset(): void {
    this.db.exec("DELETE FROM stage_metrics; DELETE FROM runs;");
  }

  insert(result: PipelineResult, metric: RecordedMetric): void {
    const insertRun = this.db.prepare(`
      INSERT INTO runs (
        source, input_id, question_id, pipeline, latency_ms, token_count,
        fidelity, task_success, vector_dim, response_text, expected_answer,
        metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = insertRun.run(
      metric.source,
      result.inputId,
      result.questionId,
      result.pipeline,
      result.latency_ms,
      result.token_count,
      metric.fidelity,
      metric.taskSuccess ? 1 : 0,
      result.vector_dim,
      result.responseText,
      metric.expectedAnswer,
      JSON.stringify(result.metadata),
      Date.now(),
    );
    const runId = Number(info.lastInsertRowid);
    const insertStage = this.db.prepare(
      "INSERT INTO stage_metrics (run_id, stage, latency_ms) VALUES (?, ?, ?)",
    );

    for (const stage of result.stages) {
      insertStage.run(runId, stage.name, stage.latency_ms);
    }
  }

  summaries(): PipelineSummary[] {
    const rows = this.db
      .prepare(
        "SELECT pipeline, latency_ms, token_count, fidelity, task_success FROM runs ORDER BY pipeline, latency_ms",
      )
      .all() as RunRow[];
    const grouped = new Map<string, RunRow[]>();

    for (const row of rows) {
      grouped.set(row.pipeline, [...(grouped.get(row.pipeline) ?? []), row]);
    }

    return [...grouped.entries()].map(([pipeline, pipelineRows]) => {
      const latencies = pipelineRows
        .map((row) => row.latency_ms)
        .sort((a, b) => a - b);
      return {
        pipeline,
        count: pipelineRows.length,
        latency_median_ms: percentile(latencies, 0.5),
        latency_p95_ms: percentile(latencies, 0.95),
        latency_p99_ms: percentile(latencies, 0.99),
        avg_tokens: average(pipelineRows.map((row) => row.token_count)),
        avg_fidelity: average(pipelineRows.map((row) => row.fidelity)),
        task_success_rate:
          average(pipelineRows.map((row) => row.task_success)) * 100,
      };
    });
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        input_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        pipeline TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        token_count INTEGER NOT NULL,
        fidelity REAL NOT NULL,
        task_success INTEGER NOT NULL,
        vector_dim INTEGER NOT NULL,
        response_text TEXT NOT NULL,
        expected_answer TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        latency_ms REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS runs_pipeline_idx ON runs(pipeline);
      CREATE INDEX IF NOT EXISTS runs_source_idx ON runs(source);
      CREATE INDEX IF NOT EXISTS stage_metrics_run_idx ON stage_metrics(run_id);
    `);
  }
}

export function summaryToCsv(summaries: PipelineSummary[]): string {
  const header = [
    "pipeline",
    "count",
    "latency_median_ms",
    "latency_p95_ms",
    "latency_p99_ms",
    "avg_tokens",
    "avg_fidelity",
    "task_success_rate",
  ];
  const rows = summaries.map((summary) =>
    [
      summary.pipeline,
      summary.count.toString(),
      summary.latency_median_ms.toFixed(3),
      summary.latency_p95_ms.toFixed(3),
      summary.latency_p99_ms.toFixed(3),
      summary.avg_tokens.toFixed(3),
      summary.avg_fidelity.toFixed(6),
      summary.task_success_rate.toFixed(3),
    ].join(","),
  );
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
