import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Type } from "typebox";
import { TextStubAdapter, VisionStubAdapter } from "./adapter.js";
import { LinearAdapter } from "./adapters/linearAdapter.js";
import { RealEncoderClient } from "./encoders/realEncoderClient.js";
import { TieredMemory, type MemoryHit } from "./memory.js";
import {
  createPacket,
  type ModalityType,
  type PacketPriority,
  type ThalamusPacket,
} from "./packet.js";
import { ThalamusRouter } from "./router.js";

type EncodeModality = "vision" | "text" | "audio";
type EncoderBackendMode = "auto" | "fallback" | "hf" | "huggingface" | "stub";

interface ThalamusPluginConfig {
  workspaceDim: number;
  memorySqlitePath?: string;
  pythonPath?: string;
  encoderBackend: EncoderBackendMode;
  useTrainedAdapters: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
}

interface EncodeParams {
  modality: EncodeModality;
  payload_path?: string;
  text?: string;
  target?: string;
  priority?: PacketPriority;
}

interface RouteParams {
  target_module?: string;
  include_vector?: boolean;
}

interface RecallParams {
  packet_id?: string;
  text_query?: string;
  k?: number;
  include_vectors?: boolean;
}

interface EncodedVector {
  vector: Float32Array;
  backend: "real" | "stub-fallback" | "stub";
}

const TOOL_NAMES = [
  "thalamus_encode",
  "thalamus_route",
  "thalamus_recall",
] as const;

const encodeParameters = Type.Object({
  modality: Type.Union([
    Type.Literal("vision"),
    Type.Literal("text"),
    Type.Literal("audio"),
  ]),
  payload_path: Type.Optional(
    Type.String({
      description: "Local path to an image/audio/text file.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "Inline text, used when payload_path is omitted.",
    }),
  ),
  target: Type.Optional(
    Type.String({
      description: "Optional target module.",
    }),
  ),
  priority: Type.Optional(
    Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
  ),
});

const routeParameters = Type.Object({
  target_module: Type.Optional(
    Type.String({
      description: "Module consuming the next packet.",
    }),
  ),
  include_vector: Type.Optional(Type.Boolean()),
});

const recallParameters = Type.Object({
  packet_id: Type.Optional(Type.String()),
  text_query: Type.Optional(Type.String()),
  k: Type.Optional(Type.Integer({ minimum: 1, default: 5 })),
  include_vectors: Type.Optional(Type.Boolean()),
});

export default definePluginEntry({
  id: "thalamus",
  name: "Thalamus",
  description: "Vector packet routing for OpenClaw agents (Phase 3-ready)",
  register(api) {
    const config = readPluginConfig(api);
    const router = new ThalamusRouter();
    const memory = new TieredMemory({
      sqlitePath: config.memorySqlitePath ?? resolveDefaultSqlitePath(),
    });
    const encoder = new LazyEncoder(api, config);
    const visionAdapter = new VisionStubAdapter();
    const textAdapter = new TextStubAdapter();
    const audioAdapter = new TextStubAdapter(384, "thalamus-audio-stub");
    const trainedImage = loadImageAdapter(api, config);

    api.registerTool({
      name: "thalamus_encode",
      description:
        "Encode an input into a thalamus packet, enqueue it, and store it in tiered memory.",
      parameters: encodeParameters,
      async execute(_toolCallId, rawParams) {
        const params = readEncodeParams(rawParams);
        const payload = readPayload(params);
        const encoded = await encoder.encode(
          params.modality,
          payload,
          params.text,
        );
        const workspace = projectToWorkspace({
          modality: params.modality,
          vector: encoded.vector,
          workspaceDim: config.workspaceDim,
          trainedImage,
          visionAdapter,
          textAdapter,
          audioAdapter,
        });

        const packet = createPacket({
          source: "thalamus_encode",
          target: params.target,
          modality: params.modality,
          vector: workspace,
          source_dim: encoded.vector.length,
          workspace_dim: config.workspaceDim,
          priority: params.priority ?? 1,
          max_hops: 3,
          metadata: {
            backend: encoded.backend,
            payload_path: params.payload_path,
          },
        });

        router.enqueue(packet);
        await memory.store(packet, summarizePacket(packet, params));

        return jsonResult({
          ok: true,
          packet_id: packet.id,
          source_dim: encoded.vector.length,
          vector_dim: workspace.length,
          backend: encoded.backend,
        });
      },
    });

    api.registerTool({
      name: "thalamus_route",
      description: "Pop the next packet from the thalamus priority queue.",
      parameters: routeParameters,
      execute(_toolCallId, rawParams) {
        const params = readRouteParams(rawParams);
        const packet = router.route();

        if (packet === null) {
          return Promise.resolve(
            jsonResult({ ok: false, reason: "queue_empty" }),
          );
        }

        return Promise.resolve(
          jsonResult({
            ok: true,
            packet_id: packet.id,
            source: packet.source,
            target: packet.target,
            target_module: params.target_module,
            modality: packet.modality,
            vector_dim: packet.vector.length,
            hop_count: packet.hop_count,
            ...(params.include_vector === true
              ? { vector: Array.from(packet.vector) }
              : {}),
          }),
        );
      },
    });

    api.registerTool({
      name: "thalamus_recall",
      description: "Retrieve stored thalamus packets by id or by text query.",
      parameters: recallParameters,
      async execute(_toolCallId, rawParams) {
        const params = readRecallParams(rawParams);

        if (params.packet_id !== undefined) {
          const hit = await memory.retrieveById(params.packet_id);
          return jsonResult({
            ok: hit !== null,
            hits:
              hit === null ? [] : [serializeHit(hit, params.include_vectors)],
          });
        }

        if (params.text_query !== undefined) {
          const hits = await memory.retrieveByText(
            params.text_query,
            params.k ?? 5,
          );
          return jsonResult({
            ok: true,
            hits: hits.map((hit) => serializeHit(hit, params.include_vectors)),
          });
        }

        return jsonResult({
          ok: false,
          reason: "need packet_id or text_query",
        });
      },
    });

    api.on("agent_end", async () => {
      try {
        const recent = await memory.retrieveRecent(3);
        for (const hit of recent) {
          await memory.store(
            packetFromHit(hit),
            `consolidated ${hit.packet_id}`,
          );
        }
      } catch (error) {
        api.logger.warn("thalamus consolidation skipped", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  },
});

export function thalamusToolNames(): readonly string[] {
  return TOOL_NAMES;
}

class LazyEncoder {
  private client: RealEncoderClient | null = null;

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly config: ThalamusPluginConfig,
  ) {}

  async encode(
    modality: EncodeModality,
    payload: Buffer,
    text?: string,
  ): Promise<EncodedVector> {
    if (this.config.encoderBackend === "stub") {
      return { vector: stubEncode(modality, payload, text), backend: "stub" };
    }

    try {
      const client = this.ensureClient();
      const input =
        modality === "text" ? (text ?? payload.toString("utf8")) : payload;
      return {
        vector: await client.encode(modality, input),
        backend: "real",
      };
    } catch (error) {
      this.api.logger.warn(
        "thalamus real encoder failed; using stub fallback",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return {
        vector: stubEncode(modality, payload, text),
        backend: "stub-fallback",
      };
    }
  }

  private ensureClient(): RealEncoderClient {
    this.client ??= new RealEncoderClient({
      pythonPath: this.config.pythonPath,
      env: {
        ...process.env,
        ...(this.config.encoderBackend === "auto"
          ? {}
          : { THALAMUS_ENCODER_BACKEND: this.config.encoderBackend }),
      },
    });
    return this.client;
  }
}

function readPluginConfig(api: OpenClawPluginApi): ThalamusPluginConfig {
  const raw = api.pluginConfig ?? {};
  return {
    workspaceDim: readPositiveInteger(raw.workspaceDim, 512),
    memorySqlitePath: readOptionalString(raw.memorySqlitePath),
    pythonPath: readOptionalString(raw.pythonPath),
    encoderBackend: readEncoderBackend(raw.encoderBackend),
    useTrainedAdapters: raw.useTrainedAdapters !== false,
    ollamaUrl: readOptionalString(raw.ollamaUrl),
    ollamaModel: readOptionalString(raw.ollamaModel),
  };
}

function readEncoderBackend(value: unknown): EncoderBackendMode {
  if (
    value === "fallback" ||
    value === "hf" ||
    value === "huggingface" ||
    value === "stub"
  ) {
    return value;
  }

  return "auto";
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readEncodeParams(raw: unknown): EncodeParams {
  const record = asRecord(raw);
  const modality = record.modality;

  if (modality !== "vision" && modality !== "text" && modality !== "audio") {
    throw new Error("modality must be vision, text, or audio");
  }

  return {
    modality,
    payload_path: readOptionalString(record.payload_path),
    text: readOptionalString(record.text),
    target: readOptionalString(record.target),
    priority: readPriority(record.priority),
  };
}

function readRouteParams(raw: unknown): RouteParams {
  const record = asRecord(raw);
  return {
    target_module: readOptionalString(record.target_module),
    include_vector: record.include_vector === true,
  };
}

function readRecallParams(raw: unknown): RecallParams {
  const record = asRecord(raw);
  return {
    packet_id: readOptionalString(record.packet_id),
    text_query: readOptionalString(record.text_query),
    k: readPositiveInteger(record.k, 5),
    include_vectors: record.include_vectors === true,
  };
}

function readPriority(value: unknown): PacketPriority | undefined {
  return value === 0 || value === 1 || value === 2 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readPayload(params: EncodeParams): Buffer {
  if (params.payload_path !== undefined) {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(params.payload_path)) {
      throw new Error("payload_path must be a local file path");
    }

    return readFileSync(params.payload_path);
  }

  return Buffer.from(params.text ?? "", "utf8");
}

function loadImageAdapter(
  api: OpenClawPluginApi,
  config: ThalamusPluginConfig,
): LinearAdapter | null {
  if (!config.useTrainedAdapters) {
    return null;
  }

  try {
    return new LinearAdapter({
      weightPath: api.resolvePath("adapters/image_to_workspace.npy"),
      sourceDim: 768,
      targetDim: config.workspaceDim,
      allowIdentityFallback: true,
    });
  } catch (error) {
    api.logger.warn("No trained image adapter; using random projection.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function projectToWorkspace(params: {
  modality: EncodeModality;
  vector: Float32Array;
  workspaceDim: number;
  trainedImage: LinearAdapter | null;
  visionAdapter: VisionStubAdapter;
  textAdapter: TextStubAdapter;
  audioAdapter: TextStubAdapter;
}): Float32Array {
  if (
    params.modality === "vision" &&
    params.trainedImage !== null &&
    params.vector.length === params.trainedImage.source_dim
  ) {
    return params.trainedImage.project_to_workspace(
      params.vector,
      params.workspaceDim,
    );
  }

  if (
    params.modality === "vision" &&
    params.vector.length === params.visionAdapter.source_dim
  ) {
    return params.visionAdapter.project_to_workspace(
      params.vector,
      params.workspaceDim,
    );
  }

  if (
    params.modality === "text" &&
    params.vector.length === params.textAdapter.source_dim
  ) {
    return params.textAdapter.project_to_workspace(
      params.vector,
      params.workspaceDim,
    );
  }

  if (
    params.modality === "audio" &&
    params.vector.length === params.audioAdapter.source_dim
  ) {
    return params.audioAdapter.project_to_workspace(
      params.vector,
      params.workspaceDim,
    );
  }

  const seed =
    params.modality === "vision"
      ? "thalamus-plugin-vision-project"
      : `thalamus-plugin-${params.modality}-project`;
  return new TextStubAdapter(params.vector.length, seed).project_to_workspace(
    params.vector,
    params.workspaceDim,
  );
}

function stubEncode(
  modality: EncodeModality,
  payload: Buffer,
  text?: string,
): Float32Array {
  if (modality === "vision") {
    return new VisionStubAdapter().encode(payload);
  }

  return new TextStubAdapter(384, `thalamus-${modality}-encode`).encode(
    modality === "text" ? (text ?? payload.toString("utf8")) : payload,
  );
}

function serializeHit(
  hit: MemoryHit,
  includeVector = false,
): Record<string, unknown> {
  return {
    packet_id: hit.packet_id,
    summary: hit.summary,
    score: hit.score,
    timestamp: hit.timestamp,
    vector_dim: hit.vector.length,
    ...(includeVector ? { vector: Array.from(hit.vector) } : {}),
  };
}

function summarizePacket(packet: ThalamusPacket, params: EncodeParams): string {
  const preview =
    params.text !== undefined
      ? params.text.slice(0, 120)
      : params.payload_path === undefined
        ? ""
        : path.basename(params.payload_path);
  return `packet_id=${packet.id} encoded ${params.modality} payload ${preview}`.trim();
}

function packetFromHit(hit: MemoryHit): ThalamusPacket {
  return createPacket({
    id: hit.packet_id,
    source: "thalamus_consolidation",
    modality: "embedding" satisfies ModalityType,
    vector: hit.vector,
    workspace_dim: hit.vector.length,
    source_dim: hit.vector.length,
    priority: 2,
    max_hops: 3,
    metadata: {
      consolidated: true,
    },
  });
}

function resolveDefaultSqlitePath(): string {
  const stateRoot =
    process.env.OPENCLAW_STATE_DIR ??
    process.env.STATE_DIRECTORY ??
    path.join(os.homedir(), ".openclaw");
  const sqlitePath = path.join(
    stateRoot,
    "agents",
    "thalamus",
    "memory",
    "thalamus.sqlite",
  );
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  return sqlitePath;
}
