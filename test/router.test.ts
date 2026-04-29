import { describe, expect, it } from "vitest";
import { createPacket } from "../src/packet.js";
import { ThalamusRouter } from "../src/router.js";

describe("thalamus router", () => {
  it("routes high priority packets before mid and low while preserving FIFO per bucket", () => {
    const router = new ThalamusRouter();
    const low = packet("low", 2);
    const midFirst = packet("mid-first", 1);
    const high = packet("high", 0);
    const midSecond = packet("mid-second", 1);

    router.enqueue(low);
    router.enqueue(midFirst);
    router.enqueue(high);
    router.enqueue(midSecond);

    expect(router.route()?.id).toBe(high.id);
    expect(router.route()?.id).toBe(midFirst.id);
    expect(router.route()?.id).toBe(midSecond.id);
    expect(router.route()?.id).toBe(low.id);
    expect(router.route()).toBeNull();
  });

  it("expires packets at max_hops and records the audit event", () => {
    const router = new ThalamusRouter();
    const expired = packet("expired", 1, { hop_count: 0, max_hops: 1 });
    let expiredEvent = false;

    router.on("expire", () => {
      expiredEvent = true;
    });
    router.enqueue(expired);

    expect(router.route()).toBeNull();
    expect(expiredEvent).toBe(true);
    expect(router.getAuditLog()).toMatchObject([
      { type: "expire", packet_id: expired.id },
    ]);
  });

  it("drops packets that try to revisit a target module", () => {
    const router = new ThalamusRouter();
    const cyclic = createPacket({
      id: "cyclic",
      source: "stub_vision",
      target: "stub_planner",
      modality: "vision",
      vector: new Float32Array([1]),
      workspace_dim: 1,
      source_dim: 256,
      metadata: {
        visited_modules: ["stub_vision", "stub_planner"],
      },
    });

    router.enqueue(cyclic);

    expect(router.route()).toBeNull();
    expect(router.getAuditLog()).toMatchObject([
      { type: "drop", reason: "cycle prevented" },
    ]);
  });

  it("reports queue depth by priority bucket", () => {
    const router = new ThalamusRouter();
    router.enqueue(packet("high", 0));
    router.enqueue(packet("mid", 1));
    router.enqueue(packet("low", 2));

    expect(router.inspect()).toEqual({ high: 1, mid: 1, low: 1 });
  });
});

function packet(
  id: string,
  priority: 0 | 1 | 2,
  overrides: Partial<{ hop_count: number; max_hops: number }> = {},
) {
  return createPacket({
    id,
    source: "source",
    target: id,
    modality: "embedding",
    vector: new Float32Array([1]),
    workspace_dim: 1,
    source_dim: 1,
    priority,
    ...overrides,
  });
}
