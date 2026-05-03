import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOME = os.homedir();
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const THALAMUS_HOME =
  process.env.THALAMUS_HOME || path.join(HOME, ".openclaw", "thalamus");
export const STATE_DIR = path.join(THALAMUS_HOME, "state");
export const REPORT_DIR = path.join(THALAMUS_HOME, "reports");
export const DATA_DIR = path.join(THALAMUS_HOME, "data");

export const OPENCLAW_JSON = path.join(HOME, ".openclaw", "openclaw.json");
export const OPENCLAW_BIN = path.join(HOME, ".npm-global", "bin", "openclaw");
export const SGA_DIR = path.join(HOME, ".openclaw", "sga_mcts");
export const SGA_PYTHON = path.join(SGA_DIR, ".venv", "bin", "python");
export const SGA_ATOMS_DB = path.join(HOME, ".openclaw", "lancedb");
export const SGA_RETRIEVER = path.join(SGA_DIR, "atom_retriever.py");
export const HAILO_BENCHMARK_HEF =
  process.env.THALAMUS_HEF || "/usr/share/hailo-models/yolov8m_h10.hef";
export const HAILO_OLLAMA_BASE_URL =
  process.env.HAILO_OLLAMA_BASE_URL || "http://127.0.0.1:8000";
export const HAILO_LOCAL_MODEL =
  process.env.THALAMUS_LOCAL_MODEL || "qwen2.5-instruct:1.5b";

export const DASHBOARD_HOST = process.env.THALAMUS_HOST || "127.0.0.1";
export const DASHBOARD_PORT = Number(process.env.THALAMUS_PORT || "18888");

export const DEFAULT_CONTEXT_TOP_K = 5;
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 4000;

export const BENCHMARK_TASKS = [
  "OpenClaw Captain should plan Sprint 5 magic implementation with proof.",
  "Builder needs a safe feature branch and tests for Ember RPG quest system.",
  "Inspector should audit a PR for fabricated claims and missing verification.",
  "Archivist should summarize a completed task into reusable memory atoms.",
  "Liaison should answer Mami with evidence from local logs only.",
  "Diagnose why Codex provider fell back to Copilot in OpenClaw trajectories.",
  "Prepare Hailo AI HAT health report without changing trading bot service.",
  "Find relevant SGA atoms for a bug fix in a README or docs task.",
  "Create a small context packet for a Godot combat UI audit.",
  "Compare baseline long prompt context against Thalamus proof packet."
];
