import { describe, expect, it } from "vitest";
import { createPacket } from "../src/packet.js";
import { TieredMemory } from "../src/memory.js";

describe("tiered memory", () => {
  it("stores packets in hot, episodic, and vector tiers", async () => {
    const memory = new TieredMemory();
    const packet = memoryPacket("one", new Float32Array([1, 0]));

    await memory.store(packet, "planner summary");

    expect(memory.size()).toEqual({ hot: 1, episodic: 1, vector: 1 });
  });

  it("retrieves by text while preserving raw vectors", async () => {
    const memory = new TieredMemory();
    const packet = memoryPacket("text-hit", new Float32Array([1, 0]));

    await memory.store(packet, "planner saw a visual workspace vector");

    const hits = await memory.retrieveByText("planner", 5);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.summary).toContain("planner");
    expect(Array.from(hits[0]?.vector ?? [])).toEqual([1, 0]);
  });

  it("retrieves nearest vectors by cosine similarity", async () => {
    const memory = new TieredMemory();
    await memory.store(memoryPacket("near", new Float32Array([1, 0])), "near");
    await memory.store(memoryPacket("far", new Float32Array([0, 1])), "far");

    const hits = await memory.retrieveByVector(new Float32Array([1, 0]), 2);

    expect(hits[0]?.packet_id).toBe("near");
    expect(hits[0]?.score).toBeGreaterThan(
      hits[1]?.score ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("retrieves a stored packet directly by id", async () => {
    const memory = new TieredMemory();
    await memory.store(
      memoryPacket("direct-hit", new Float32Array([1, 0])),
      "direct packet summary",
    );

    const hit = await memory.retrieveById("direct-hit");

    expect(hit?.packet_id).toBe("direct-hit");
    expect(hit?.summary).toBe("direct packet summary");
    expect(Array.from(hit?.vector ?? [])).toEqual([1, 0]);
  });

  it("retrieves recent stored packets in reverse chronological order", async () => {
    const memory = new TieredMemory();
    await memory.store(
      memoryPacket("first", new Float32Array([1, 0])),
      "first",
    );
    await memory.store(
      memoryPacket("second", new Float32Array([0, 1])),
      "second",
    );

    const hits = await memory.retrieveRecent(2);

    expect(hits.map((hit) => hit.packet_id)).toEqual(["second", "first"]);
  });

  it("enforces hot tier LRU capacity", async () => {
    const memory = new TieredMemory({ hotMaxEntries: 1 });

    await memory.store(
      memoryPacket("first", new Float32Array([1, 0])),
      "first",
    );
    await memory.store(
      memoryPacket("second", new Float32Array([0, 1])),
      "second",
    );

    expect(memory.size()).toEqual({ hot: 1, episodic: 2, vector: 2 });
  });
});

function memoryPacket(id: string, vector: Float32Array) {
  return createPacket({
    id,
    source: "stub_planner",
    modality: "embedding",
    vector,
    workspace_dim: vector.length,
    source_dim: vector.length,
  });
}
