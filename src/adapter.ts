import { createHash } from "node:crypto";
import type { ModalityType } from "./packet.js";
import { normalizeVector } from "./vector.js";

export abstract class ModalityAdapter {
  abstract readonly modality: ModalityType;
  abstract readonly source_dim: number;
  abstract encode(input: Buffer | string): Float32Array;
  abstract project_to_workspace(
    vec: Float32Array,
    target_dim: number,
  ): Float32Array;
}

abstract class RandomProjectionAdapter extends ModalityAdapter {
  private readonly projectionMatrices = new Map<number, Float32Array>();

  protected constructor(
    public readonly source_dim: number,
    private readonly projectionSeed: string,
  ) {
    super();

    if (!Number.isInteger(source_dim) || source_dim <= 0) {
      throw new Error("source_dim must be a positive integer");
    }
  }

  project_to_workspace(vec: Float32Array, target_dim: number): Float32Array {
    if (vec.length !== this.source_dim) {
      throw new Error("input vector length must match source_dim");
    }

    if (!Number.isInteger(target_dim) || target_dim <= 0) {
      throw new Error("target_dim must be a positive integer");
    }

    const matrix = this.projectionMatrix(target_dim);
    const projected = new Float32Array(target_dim);

    for (let row = 0; row < target_dim; row += 1) {
      let sum = 0;
      const offset = row * this.source_dim;

      for (let column = 0; column < this.source_dim; column += 1) {
        sum += (matrix[offset + column] ?? 0) * (vec[column] ?? 0);
      }

      projected[row] = sum;
    }

    return normalizeVector(projected);
  }

  protected projectionMatrix(target_dim: number): Float32Array {
    const cached = this.projectionMatrices.get(target_dim);
    if (cached !== undefined) {
      return cached;
    }

    const matrix = createProjectionMatrix(
      this.source_dim,
      target_dim,
      `${this.projectionSeed}:${target_dim}`,
    );
    this.projectionMatrices.set(target_dim, matrix);
    return matrix;
  }
}

export class TextStubAdapter extends RandomProjectionAdapter {
  readonly modality = "text" as const;

  constructor(source_dim = 384, seed = "thalamus-text-stub") {
    super(source_dim, seed);
  }

  encode(input: Buffer | string): Float32Array {
    const buffer = toBuffer(input);
    const vector = new Float32Array(this.source_dim);
    let offset = 0;
    let counter = 0;

    while (offset < this.source_dim) {
      const digest = createHash("sha256")
        .update(buffer)
        .update(uint32Buffer(counter))
        .digest();

      for (
        let byte = 0;
        byte <= digest.length - 4 && offset < this.source_dim;
        byte += 4
      ) {
        const unit = digest.readUInt32BE(byte) / 0xffffffff;
        vector[offset] = unit * 2 - 1;
        offset += 1;
      }

      counter += 1;
    }

    return normalizeVector(vector);
  }
}

export class VisionStubAdapter extends RandomProjectionAdapter {
  readonly modality = "vision" as const;

  constructor(source_dim = 256, seed = "thalamus-vision-stub") {
    super(source_dim, seed);
  }

  encode(input: Buffer | string): Float32Array {
    const buffer = toBuffer(input);
    const seed = seedFromBuffer(buffer);
    const random = mulberry32(seed);
    const vector = new Float32Array(this.source_dim);

    for (let index = 0; index < this.source_dim; index += 1) {
      vector[index] = random() * 2 - 1;
    }

    return normalizeVector(vector);
  }
}

function createProjectionMatrix(
  source_dim: number,
  target_dim: number,
  seed: string,
): Float32Array {
  const random = mulberry32(seedFromString(seed));
  const matrix = new Float32Array(source_dim * target_dim);
  const scale = 1 / Math.sqrt(source_dim);

  for (let index = 0; index < matrix.length; index += 1) {
    matrix[index] = random() < 0.5 ? -scale : scale;
  }

  return matrix;
}

function toBuffer(input: Buffer | string): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
}

function uint32Buffer(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function seedFromBuffer(buffer: Buffer): number {
  return createHash("sha256").update(buffer).digest().readUInt32BE(0);
}

function seedFromString(value: string): number {
  return seedFromBuffer(Buffer.from(value, "utf8"));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
