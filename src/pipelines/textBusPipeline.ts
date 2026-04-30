import { performance } from "node:perf_hooks";
import type { RealEncoderClient } from "../encoders/realEncoderClient.js";
import {
  answerEmbedding,
  answerQuestionFromCaption,
  countApproxTokens,
} from "./plannerStub.js";
import type { PipelineInput, PipelineResult, StageMetric } from "./types.js";

export class TextBusPipeline {
  constructor(private readonly encoder: RealEncoderClient) {}

  async run(input: PipelineInput): Promise<PipelineResult> {
    const started = performance.now();
    const stages: StageMetric[] = [];

    const visionVector = await timeStage(stages, "vision_encode", () =>
      this.encoder.encode("vision", input.imageBytes),
    );
    const caption = await timeStage(stages, "caption", () =>
      this.encoder.captionImage(input.imageBytes),
    );
    const textVector = await timeStage(stages, "text_reembed", () =>
      this.encoder.encode("text", `${caption}\nQuestion: ${input.question}`),
    );
    const responseText = await timeStage(stages, "planner_stub", () =>
      Promise.resolve(answerQuestionFromCaption(caption, input.question)),
    );
    const outputVector = answerEmbedding(responseText);

    return {
      pipeline: "text-bus",
      inputId: input.inputId,
      questionId: input.questionId,
      responseText,
      outputVector,
      latency_ms: performance.now() - started,
      token_count:
        countApproxTokens(caption) +
        countApproxTokens(input.question) +
        countApproxTokens(responseText),
      vector_dim: outputVector.length,
      stages,
      metadata: {
        caption,
        vision_dim: visionVector.length,
        text_dim: textVector.length,
      },
    };
  }
}

async function timeStage<T>(
  stages: StageMetric[],
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const value = await fn();
  stages.push({ name, latency_ms: performance.now() - started });
  return value;
}
