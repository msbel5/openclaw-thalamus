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
export const PACKET_DIR = path.join(STATE_DIR, "packets");
export const VECTOR_STORE_DIR = path.join(STATE_DIR, "vectors");
export const VECTOR_CACHE_DIR = path.join(THALAMUS_HOME, ".cache", "normalizers");
export const AOT_EVENTS_PATH = path.join(STATE_DIR, "aot-events.jsonl");

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
export const HAILO_LOCAL_KEEP_ALIVE =
  process.env.THALAMUS_LOCAL_KEEP_ALIVE || "0s";
export const HAILO_APPS_DIR = path.join(HOME, "projects-alcyone", "hailo-apps");
export const HAILO_APPS_PYTHON = path.join(HAILO_APPS_DIR, "venv_hailo_apps", "bin", "python");
export const HAILO_ENCODERS = {
  whisper_10s: "/usr/local/hailo/resources/models/hailo10h/base-whisper-encoder-10s.hef",
  clip_image: "/usr/local/hailo/resources/models/hailo10h/clip_vit_b_32_image_encoder.hef",
  clip_text: "/usr/local/hailo/resources/models/hailo10h/clip_vit_b_32_text_encoder.hef"
};
export const VIDEO_FRAME_FPS = Number(process.env.THALAMUS_VIDEO_FPS || "1");
export const VIDEO_MAX_FRAMES = Number(process.env.THALAMUS_VIDEO_MAX_FRAMES || "30");
export const INGEST_SOURCES = {
  "telegram:msbel": "Mami via Telegram",
  "telegram:*": "Telegram users",
  "agent:liaison": "Liaison agent",
  "agent:captain": "Captain agent",
  "agent:builder": "Builder agent",
  "agent:inspector": "Inspector agent",
  "agent:archivist": "Archivist agent",
  cli: "CLI invocation",
  "watch:*": "File watchers",
  manual: "Manual or unknown"
};

export const PACKET_TTL_DAYS = Number(process.env.THALAMUS_PACKET_TTL_DAYS || "30");
export const PACKET_MAX_COUNT = Number(process.env.THALAMUS_PACKET_MAX_COUNT || "5000");

export const VECTOR_NAMESPACES = {
  "atoms.code": { dim: 512, side: "text", model: "distiluse-base-multilingual-cased-v2", threshold: 0.85 },
  "atoms.audit": { dim: 512, side: "text", model: "distiluse-base-multilingual-cased-v2", threshold: 0.85 },
  "atoms.plan": { dim: 512, side: "text", model: "distiluse-base-multilingual-cased-v2", threshold: 0.85 },
  "atoms.memory": { dim: 512, side: "text", model: "distiluse-base-multilingual-cased-v2", threshold: 0.92 },
  "atoms.audio.raw": { dim: 512, side: "audio", model: "hailo-whisper-encoder", threshold: 0.85 },
  "atoms.audio.text": { dim: 512, side: "audio", model: "distiluse-base-multilingual-cased-v2", threshold: 0.85 },
  "atoms.image.raw": { dim: 512, side: "image", model: "hailo-clip-image", threshold: 0.85 },
  "atoms.image.text": { dim: 512, side: "image", model: "distiluse-base-multilingual-cased-v2", threshold: 0.85 },
  "atoms.crossmodal": { dim: 512, side: "crossmodal", model: "hailo-clip-shared", threshold: 0.85 }
};

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
