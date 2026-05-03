import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  PACKET_DIR,
  REPORT_DIR,
  STATE_DIR,
  VECTOR_CACHE_DIR,
  VECTOR_STORE_DIR
} from "./config.js";

export async function ensureDirs() {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(PACKET_DIR, { recursive: true }),
    fs.mkdir(REPORT_DIR, { recursive: true }),
    fs.mkdir(STATE_DIR, { recursive: true }),
    fs.mkdir(VECTOR_CACHE_DIR, { recursive: true }),
    fs.mkdir(VECTOR_STORE_DIR, { recursive: true })
  ]);
}

export function runFile(file, args = [], options = {}) {
  const started = Date.now();
  const timeout = options.timeout ?? 15_000;
  const env = { ...process.env, ...(options.env || {}) };
  return new Promise((resolve) => {
    execFile(file, args, { timeout, env, cwd: options.cwd }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        ms: Date.now() - started
      });
    });
  });
}

export async function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendJsonl(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function roughTokenEstimate(textOrObject) {
  const text = typeof textOrObject === "string" ? textOrObject : JSON.stringify(textOrObject);
  return Math.ceil(text.length / 4);
}

export function stableId(prefix, input) {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  let hash = 2166136261;
  const text = typeof input === "string" ? input : JSON.stringify(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${now}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

export function redact(text) {
  if (!text) return "";
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-REDACTED")
    .replace(/ac_[A-Za-z0-9._-]{16,}/g, "ac_REDACTED")
    .replace(/(OPENAI_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(ANTHROPIC_API_KEY=)[^\s]+/g, "$1REDACTED")
    .replace(/(token|password|secret)["']?\s*[:=]\s*["'][^"']+["']/gi, "$1:REDACTED");
}

export async function fileSizeTokens(files) {
  let chars = 0;
  const existing = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      chars += stat.size;
      existing.push(file);
    } catch {
      // ignore missing context files
    }
  }
  return { files: existing, bytes: chars, tokens: Math.ceil(chars / 4) };
}
