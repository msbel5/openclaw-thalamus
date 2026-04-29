import { describe, expect, it } from "vitest";
import { TextStubAdapter, VisionStubAdapter } from "../src/adapter.js";

describe("stub adapters", () => {
  it("produces deterministic text embeddings and projections", () => {
    const adapter = new TextStubAdapter(16);
    const first = adapter.project_to_workspace(adapter.encode("same input"), 8);
    const second = adapter.project_to_workspace(
      adapter.encode("same input"),
      8,
    );

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("seeds vision vectors from input bytes", () => {
    const adapter = new VisionStubAdapter(16);
    const first = adapter.encode(Buffer.from([1, 2, 3]));
    const second = adapter.encode(Buffer.from([1, 2, 3]));
    const other = adapter.encode(Buffer.from([1, 2, 4]));

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(Array.from(first)).not.toEqual(Array.from(other));
  });
});
