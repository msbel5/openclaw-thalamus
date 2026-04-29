import { describe, expect, it } from "vitest";
import { createPacket, isExpired } from "../src/packet.js";

describe("packet schema", () => {
  it("creates a packet with strict defaults and a copied vector", () => {
    const vector = new Float32Array([1, 2, 3]);
    const packet = createPacket({
      source: "text_encoder",
      modality: "text",
      vector,
      workspace_dim: 3,
      source_dim: 3,
    });

    vector[0] = 99;

    expect(packet.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(packet.priority).toBe(1);
    expect(packet.max_hops).toBe(3);
    expect(packet.vector[0]).toBe(1);
    expect(packet.metadata.visited_modules).toEqual(["text_encoder"]);
  });

  it("reports expiration when hop_count reaches max_hops", () => {
    const packet = createPacket({
      source: "vision_encoder",
      modality: "vision",
      vector: new Float32Array([1]),
      workspace_dim: 1,
      source_dim: 256,
      hop_count: 3,
      max_hops: 3,
    });

    expect(isExpired(packet)).toBe(true);
  });

  it("rejects vectors that do not match workspace_dim", () => {
    expect(() =>
      createPacket({
        source: "vision_encoder",
        modality: "vision",
        vector: new Float32Array([1, 2]),
        workspace_dim: 3,
        source_dim: 256,
      }),
    ).toThrow(/workspace_dim/u);
  });
});
