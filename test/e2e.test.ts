import { describe, expect, it } from "vitest";
import { TextStubAdapter, VisionStubAdapter } from "../src/adapter.js";
import { TieredMemory } from "../src/memory.js";
import { createPacket } from "../src/packet.js";
import { ThalamusRouter } from "../src/router.js";

describe("thalamus phase 1 e2e", () => {
  it("routes a vision packet through to a planner stub and stores both vector and summary", async () => {
    const router = new ThalamusRouter();
    const memory = new TieredMemory();
    const visionAdapter = new VisionStubAdapter(256);
    const textAdapter = new TextStubAdapter(384);
    const fixtureImage = Buffer.from("phase-1-fixture-image");

    const v = visionAdapter.encode(fixtureImage);
    const w = visionAdapter.project_to_workspace(v, 512);

    expect(
      textAdapter.project_to_workspace(textAdapter.encode("planner"), 512),
    ).toHaveLength(512);

    const packet = createPacket({
      source: "stub_vision",
      target: "stub_planner",
      modality: "vision",
      vector: w,
      source_dim: 256,
      workspace_dim: 512,
      priority: 1,
      max_hops: 3,
    });

    router.enqueue(packet);

    const popped = router.route();
    expect(popped).not.toBeNull();
    const responseText = `planner saw vector of dim ${popped?.vector.length}`;

    await memory.store(popped!, responseText);

    const hitsText = await memory.retrieveByText("planner", 5);
    const hitsVec = await memory.retrieveByVector(w, 5);

    expect(hitsText.length).toBeGreaterThan(0);
    expect(hitsVec.length).toBeGreaterThan(0);
    expect(hitsText[0]?.vector).toBeDefined();
    expect(hitsText[0]?.vector).toBeInstanceOf(Float32Array);
  });
});
