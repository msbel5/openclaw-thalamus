// Thalamus Encoder Daemon Client (UNIX socket, JSON-RPC line-framed)
// Speaks to ~/.openclaw/thalamus/ipc.sock when available.
// Falls back gracefully (caller decides) when daemon down.

import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET_PATH = process.env.THALAMUS_ENCODER_SOCKET ||
  path.join(os.homedir(), ".openclaw", "thalamus", "ipc.sock");

const DEFAULT_TIMEOUT_MS = Number(process.env.THALAMUS_ENCODER_TIMEOUT_MS || "120000");

// Fast probe to know if daemon is reachable. Used by callers to decide
// whether to hit the socket or fall back to subprocess immediately.
export async function isAvailable(timeoutMs = 1000) {
  return await new Promise((resolve) => {
    const sock = net.createConnection(SOCKET_PATH);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function call(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH);
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error(`encoder daemon timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    sock.on("connect", () => {
      const payload = JSON.stringify({ method, params, id: 1 }) + "\n";
      sock.write(payload);
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        const line = buf.slice(0, idx);
        sock.end();
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(new Error(`encoder daemon bad JSON: ${err.message}`));
        }
      }
    });
    sock.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    sock.on("end", () => {
      if (settled) return;
      // Server closed without sending a full line
      settled = true;
      clearTimeout(timer);
      reject(new Error("encoder daemon closed connection without response"));
    });
  });
}

export async function embedTextViaDaemon(text) {
  const out = await call("embed_text", { text });
  if (!out || !out.ok || !Array.isArray(out.vector)) {
    throw new Error(out?.error || "embed_text failed");
  }
  return out;
}
