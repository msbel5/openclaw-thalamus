import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runExperiment } from "../src/experiments/runExperiment.js";

describe("experiment harness", () => {
  it("writes SQLite and CSV outputs for a small controlled subset", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "thalamus-exp-"));
    const resultsPath = path.join(tmp, "results.sqlite");

    try {
      process.env.THALAMUS_INPUTS = "ppm";
      const summaries = await runExperiment({
        limit: 2,
        resultsPath,
        inputsDir: path.join(tmp, "inputs"),
      });

      expect(summaries).toHaveLength(2);
      expect((await stat(resultsPath)).size).toBeGreaterThan(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
