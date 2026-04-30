import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import type { ModalityType } from "../packet.js";

export interface RealEncoderClientOptions {
  pythonPath?: string;
  serverPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  stderr?: "inherit" | "ignore";
}

export interface EncoderResponseMetadata {
  backend: string;
  latency_ms: number;
}

interface PendingRequest {
  resolve: (value: EncoderServerResponse) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

interface EncoderServerResponse {
  id: string;
  ok: boolean;
  backend?: string;
  vector?: number[];
  caption?: string;
  latency_ms?: number;
  error?: string;
}

export class RealEncoderClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pythonPath: string;
  private readonly serverPath: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly requestTimeoutMs: number;
  private readonly stderr: "inherit" | "ignore";

  constructor(options: RealEncoderClientOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.pythonPath = options.pythonPath ?? process.env.PYTHON ?? "python";
    this.serverPath =
      options.serverPath ??
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../encoders/python/encoder_server.py",
      );
    this.env = withDefaultModelCache({
      ...process.env,
      ...(options.env ?? {}),
    });
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? resolveRequestTimeoutMs();
    this.stderr = options.stderr ?? "ignore";
  }

  async encode(
    modality: ModalityType,
    payload: Buffer | string,
  ): Promise<Float32Array> {
    const response = await this.request({
      op: "encode",
      modality,
      payload,
      text: typeof payload === "string" ? payload : undefined,
    });

    if (response.vector === undefined) {
      throw new Error("encoder response did not include a vector");
    }

    return Float32Array.from(response.vector);
  }

  async captionImage(payload: Buffer): Promise<string> {
    const response = await this.request({
      op: "caption",
      modality: "vision",
      payload,
    });

    if (response.caption === undefined) {
      throw new Error("encoder response did not include a caption");
    }

    return response.caption;
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`encoder client closed before response ${id}`));
    }
    this.pending.clear();

    if (this.child !== null) {
      this.child.kill();
      this.child = null;
    }
  }

  private async request(input: {
    op: "encode" | "caption";
    modality: ModalityType;
    payload: Buffer | string;
    text?: string;
  }): Promise<EncoderServerResponse> {
    const child = this.ensureStarted();
    const id = ulid();
    const payloadBuffer = Buffer.isBuffer(input.payload)
      ? input.payload
      : Buffer.from(input.payload, "utf8");

    const responsePromise = new Promise<EncoderServerResponse>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new Error(
              `encoder request timed out after ${this.requestTimeoutMs}ms`,
            ),
          );
        }, this.requestTimeoutMs);

        this.pending.set(id, { resolve, reject, timeout });
      },
    );

    child.stdin.write(
      `${JSON.stringify({
        id,
        op: input.op,
        modality: input.modality,
        payload_base64: payloadBuffer.toString("base64"),
        ...(input.text === undefined ? {} : { text: input.text }),
      })}\n`,
    );

    const response = await responsePromise;
    if (!response.ok) {
      throw new Error(response.error ?? "encoder request failed");
    }

    return response;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child !== null) {
      return this.child;
    }

    const child = spawn(this.pythonPath, [this.serverPath], {
      cwd: this.cwd,
      env: this.env,
      stdio: "pipe",
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      this.handleLine(line);
    });

    if (this.stderr === "inherit") {
      child.stderr.pipe(process.stderr);
    }

    child.on("exit", (code, signal) => {
      const reason = new Error(
        `encoder server exited with code ${code?.toString() ?? "null"} signal ${
          signal ?? "null"
        }`,
      );
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`${reason.message}; pending=${id}`));
      }
      this.pending.clear();
      this.child = null;
    });

    child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
      this.child = null;
    });

    this.child = child;
    return child;
  }

  private handleLine(line: string): void {
    let response: EncoderServerResponse;
    try {
      response = JSON.parse(line) as EncoderServerResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve(response);
  }
}

function withDefaultModelCache(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.HF_HOME !== undefined) {
    return env;
  }

  if (process.platform === "win32" && existsSync("D:\\")) {
    const hfHome = "D:\\hf-cache\\main";
    return {
      ...env,
      HF_HOME: hfHome,
      HF_HUB_CACHE: `${hfHome}\\hub`,
      SENTENCE_TRANSFORMERS_HOME: `${hfHome}\\sentence-transformers`,
      TRANSFORMERS_CACHE: `${hfHome}\\transformers`,
    };
  }

  return env;
}

function resolveRequestTimeoutMs(): number {
  const configured = Number(process.env.THALAMUS_ENCODER_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  const backend = process.env.THALAMUS_ENCODER_BACKEND?.toLowerCase();
  return backend === "hf" || backend === "huggingface" ? 600_000 : 120_000;
}
