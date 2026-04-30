import { answerQuestionFromWorkspace } from "./plannerStub.js";

export interface LLMPlannerOptions {
  url?: string;
  model?: string;
}

interface OllamaGenerateResponse {
  response?: unknown;
}

export class LLMPlanner {
  constructor(private readonly opts: LLMPlannerOptions = {}) {}

  async planFromVector(vec: Float32Array, question: string): Promise<string> {
    const url = this.opts.url ?? "http://localhost:11434";
    const model = this.opts.model ?? "phi3:mini";
    const topActivations = topKActivations(vec, 8);
    const prompt = `Workspace vector top features: ${topActivations.join(", ")}.
Question: ${question}
Answer in 1-3 words:`;

    try {
      const response = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, prompt, stream: false }),
      });

      if (!response.ok) {
        return answerQuestionFromWorkspace(vec, question);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      return typeof data.response === "string" && data.response.trim() !== ""
        ? data.response.trim()
        : answerQuestionFromWorkspace(vec, question);
    } catch {
      return answerQuestionFromWorkspace(vec, question);
    }
  }
}

export function topKActivations(vec: Float32Array, k: number): string[] {
  return Array.from(vec)
    .map((value, index) => ({
      index,
      magnitude: Math.abs(value),
    }))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, k)
    .map((item) => `dim${item.index}=${item.magnitude.toFixed(2)}`);
}
