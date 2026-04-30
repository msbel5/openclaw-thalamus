import { existsSync, readFileSync } from "node:fs";
import { normalizeVector } from "../vector.js";

export interface LinearAdapterOptions {
  weightPath: string;
  sourceDim: number;
  targetDim?: number;
  allowIdentityFallback?: boolean;
}

export class LinearAdapter {
  readonly source_dim: number;
  readonly target_dim: number;
  private readonly weights: Float32Array;

  constructor(options: LinearAdapterOptions) {
    this.source_dim = options.sourceDim;
    this.target_dim = options.targetDim ?? 512;

    if (!Number.isInteger(this.source_dim) || this.source_dim <= 0) {
      throw new Error("sourceDim must be a positive integer");
    }

    if (!Number.isInteger(this.target_dim) || this.target_dim <= 0) {
      throw new Error("targetDim must be a positive integer");
    }

    if (existsSync(options.weightPath)) {
      const loaded = loadNpyFloat32Matrix(options.weightPath);
      if (
        loaded.rows !== this.target_dim ||
        loaded.columns !== this.source_dim
      ) {
        throw new Error(
          `adapter weight shape ${loaded.rows}x${loaded.columns} does not match ${this.target_dim}x${this.source_dim}`,
        );
      }
      this.weights = loaded.values;
      return;
    }

    if (options.allowIdentityFallback === true) {
      this.weights = createIdentityProjection(this.target_dim, this.source_dim);
      return;
    }

    throw new Error(
      `adapter weight file does not exist: ${options.weightPath}`,
    );
  }

  project_to_workspace(
    vec: Float32Array,
    target_dim = this.target_dim,
  ): Float32Array {
    if (target_dim !== this.target_dim) {
      throw new Error(
        `target_dim ${target_dim} does not match loaded adapter target_dim ${this.target_dim}`,
      );
    }

    if (vec.length !== this.source_dim) {
      throw new Error("input vector length must match adapter source_dim");
    }

    const projected = new Float32Array(this.target_dim);

    for (let row = 0; row < this.target_dim; row += 1) {
      const offset = row * this.source_dim;
      let sum = 0;

      for (let column = 0; column < this.source_dim; column += 1) {
        sum += (this.weights[offset + column] ?? 0) * (vec[column] ?? 0);
      }

      projected[row] = sum;
    }

    return normalizeVector(projected);
  }
}

interface LoadedMatrix {
  rows: number;
  columns: number;
  values: Float32Array;
}

function loadNpyFloat32Matrix(path: string): LoadedMatrix {
  const buffer = readFileSync(path);
  const magic = buffer.subarray(0, 6).toString("binary");
  if (magic !== "\x93NUMPY") {
    throw new Error(`not a numpy .npy file: ${path}`);
  }

  const major = buffer.readUInt8(6);
  const headerLengthOffset = 8;
  const headerLength =
    major <= 1
      ? buffer.readUInt16LE(headerLengthOffset)
      : buffer.readUInt32LE(headerLengthOffset);
  const dataOffset = headerLengthOffset + (major <= 1 ? 2 : 4) + headerLength;
  const header = buffer
    .subarray(headerLengthOffset + (major <= 1 ? 2 : 4), dataOffset)
    .toString("latin1");

  if (
    !header.includes("'descr': '<f4'") &&
    !header.includes('"descr": "<f4"')
  ) {
    throw new Error("only little-endian float32 .npy matrices are supported");
  }

  if (
    !header.includes("'fortran_order': False") &&
    !header.includes('"fortran_order": false')
  ) {
    throw new Error("fortran-order .npy matrices are not supported");
  }

  const shapeMatch = /\(\s*(\d+)\s*,\s*(\d+)\s*,?\s*\)/u.exec(header);
  if (shapeMatch === null) {
    throw new Error(`could not parse .npy matrix shape from ${path}`);
  }

  const rows = Number(shapeMatch[1]);
  const columns = Number(shapeMatch[2]);
  const values = new Float32Array(rows * columns);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset + dataOffset,
    rows * columns * Float32Array.BYTES_PER_ELEMENT,
  );

  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      true,
    );
  }

  return { rows, columns, values };
}

function createIdentityProjection(
  targetDim: number,
  sourceDim: number,
): Float32Array {
  const weights = new Float32Array(targetDim * sourceDim);
  const shared = Math.min(targetDim, sourceDim);

  for (let index = 0; index < shared; index += 1) {
    weights[index * sourceDim + index] = 1;
  }

  return weights;
}
