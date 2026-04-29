import { ulid } from "ulid";

export type ModalityType = "text" | "vision" | "audio" | "embedding";

export type PacketPriority = 0 | 1 | 2;

export interface ThalamusPacket {
  id: string;
  source: string;
  target?: string;
  modality: ModalityType;
  vector: Float32Array;
  workspace_dim: number;
  source_dim: number;
  priority: PacketPriority;
  timestamp: number;
  hop_count: number;
  max_hops: number;
  metadata: Record<string, unknown>;
  audit?: {
    producer_signature?: string;
    chain_prev?: string;
  };
}

export interface CreatePacketInput {
  id?: string;
  source: string;
  target?: string;
  modality: ModalityType;
  vector: Float32Array;
  workspace_dim: number;
  source_dim: number;
  priority?: PacketPriority;
  timestamp?: number;
  hop_count?: number;
  max_hops?: number;
  metadata?: Record<string, unknown>;
  audit?: ThalamusPacket["audit"];
}

export function createPacket(input: CreatePacketInput): ThalamusPacket {
  validateCreatePacketInput(input);

  return {
    id: input.id ?? ulid(),
    source: input.source,
    ...(input.target === undefined ? {} : { target: input.target }),
    modality: input.modality,
    vector: new Float32Array(input.vector),
    workspace_dim: input.workspace_dim,
    source_dim: input.source_dim,
    priority: input.priority ?? 1,
    timestamp: input.timestamp ?? Date.now(),
    hop_count: input.hop_count ?? 0,
    max_hops: input.max_hops ?? 3,
    metadata: {
      ...(input.metadata ?? {}),
      visited_modules: normalizeVisitedModules(
        input.metadata?.visited_modules,
        input.source,
      ),
    },
    ...(input.audit === undefined ? {} : { audit: input.audit }),
  };
}

export function isExpired(packet: ThalamusPacket): boolean {
  return packet.hop_count >= packet.max_hops;
}

function validateCreatePacketInput(input: CreatePacketInput): void {
  if (input.source.trim().length === 0) {
    throw new Error("packet source is required");
  }

  if (!Number.isInteger(input.workspace_dim) || input.workspace_dim <= 0) {
    throw new Error("workspace_dim must be a positive integer");
  }

  if (!Number.isInteger(input.source_dim) || input.source_dim <= 0) {
    throw new Error("source_dim must be a positive integer");
  }

  if (input.vector.length !== input.workspace_dim) {
    throw new Error("vector length must equal workspace_dim");
  }

  const priority = input.priority ?? 1;
  if (priority !== 0 && priority !== 1 && priority !== 2) {
    throw new Error("priority must be 0, 1, or 2");
  }

  const hopCount = input.hop_count ?? 0;
  if (!Number.isInteger(hopCount) || hopCount < 0) {
    throw new Error("hop_count must be a non-negative integer");
  }

  const maxHops = input.max_hops ?? 3;
  if (!Number.isInteger(maxHops) || maxHops <= 0) {
    throw new Error("max_hops must be a positive integer");
  }
}

function normalizeVisitedModules(value: unknown, source: string): string[] {
  const visited = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

  return visited.includes(source) ? visited : [source, ...visited];
}
