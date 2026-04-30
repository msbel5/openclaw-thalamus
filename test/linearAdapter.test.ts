import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LinearAdapter } from "../src/adapters/linearAdapter.js";

describe("linear adapter", () => {
  it("loads .npy weights and projects into workspace", () => {
    const weightsPath = path.join(
      mkdtempSync(path.join(os.tmpdir(), "thalamus-adapter-")),
      "weights.npy",
    );
    writeFileSync(
      weightsPath,
      createNpyFloat32Matrix(
        3,
        4,
        new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, -1, 0]),
      ),
    );

    const adapter = new LinearAdapter({
      weightPath: weightsPath,
      sourceDim: 4,
      targetDim: 3,
    });
    const vector = new Float32Array(4);
    vector[0] = 1;
    vector[1] = 1;

    const projected = adapter.project_to_workspace(vector);

    expect(projected).toHaveLength(3);
    expect(projected[0]).toBeCloseTo(2 / Math.sqrt(13));
    expect(projected[1]).toBeCloseTo(3 / Math.sqrt(13));
    expect(projected[2]).toBe(0);
  });
});

function createNpyFloat32Matrix(
  rows: number,
  columns: number,
  values: Float32Array,
): Buffer {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${columns}), }`;
  const prefixLength = 10;
  const padding = (16 - ((prefixLength + header.length + 1) % 16)) % 16;
  header = `${header}${" ".repeat(padding)}\n`;
  const buffer = Buffer.alloc(prefixLength + header.length + values.length * 4);

  buffer.write("\x93NUMPY", 0, "binary");
  buffer[6] = 1;
  buffer[7] = 0;
  buffer.writeUInt16LE(header.length, 8);
  buffer.write(header, prefixLength, "latin1");

  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(
      values[index] ?? 0,
      prefixLength + header.length + index * 4,
    );
  }

  return buffer;
}
