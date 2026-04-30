import { describe, expect, it } from "vitest";
import { RealEncoderClient } from "../src/encoders/realEncoderClient.js";
import { loadControlledInputs } from "../src/experiments/controlledInputs.js";
import { TextBusPipeline } from "../src/pipelines/textBusPipeline.js";
import { ThalamusPipeline } from "../src/pipelines/thalamusPipeline.js";

describe("phase 2 pipelines", () => {
  it("runs both pipelines with comparable result shapes", async () => {
    process.env.THALAMUS_INPUTS = "ppm";
    const [input] = await loadControlledInputs();
    expect(input).toBeDefined();
    const client = new RealEncoderClient({ requestTimeoutMs: 10_000 });

    try {
      const textBus = await new TextBusPipeline(client).run(input!);
      const thalamus = await new ThalamusPipeline(client, {
        useTrainedAdapters: true,
      }).run(input!);

      expect(textBus.pipeline).toBe("text-bus");
      expect(thalamus.pipeline).toBe("thalamus");
      expect(textBus.token_count).toBeGreaterThan(0);
      expect(thalamus.token_count).toBe(0);
      expect(textBus.outputVector).toHaveLength(thalamus.outputVector.length);
      expect(thalamus.vector_dim).toBe(512);
    } finally {
      client.close();
    }
  });
});
