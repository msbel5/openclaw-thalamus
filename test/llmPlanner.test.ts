import { describe, expect, it } from "vitest";
import { LLMPlanner } from "../src/pipelines/llmPlanner.js";
import { answerQuestionFromWorkspace } from "../src/pipelines/plannerStub.js";

describe("llm planner", () => {
  it("falls back to the rule-based planner when Ollama is unreachable", async () => {
    const planner = new LLMPlanner({ url: "http://127.0.0.1:1" });
    const vector = new Float32Array(512);
    vector[0] = 1;
    vector[16] = 1;

    await expect(
      planner.planFromVector(vector, "what is the dominant color?"),
    ).resolves.toBe(
      answerQuestionFromWorkspace(vector, "what is the dominant color?"),
    );
  });
});
