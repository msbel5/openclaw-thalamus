import { describe, expect, it } from "vitest";
import { RealEncoderClient } from "../src/encoders/realEncoderClient.js";

describe("real encoder client", () => {
  it("encodes text through the Python JSONL server", async () => {
    const client = new RealEncoderClient({ requestTimeoutMs: 10_000 });

    try {
      const vector = await client.encode("text", "a red square");

      expect(vector).toBeInstanceOf(Float32Array);
      expect(vector).toHaveLength(384);
    } finally {
      client.close();
    }
  });
});
