import path from "node:path";
import { performance } from "node:perf_hooks";
import { VisionStubAdapter } from "../adapter.js";
import { LinearAdapter } from "../adapters/linearAdapter.js";
import type { RealEncoderClient } from "../encoders/realEncoderClient.js";
import { LLMPlanner } from "./llmPlanner.js";
import { answerEmbedding, answerQuestionFromWorkspace } from "./plannerStub.js";
import type { PipelineInput, PipelineResult, StageMetric } from "./types.js";

export interface ThalamusPipelineOptions {
  useTrainedAdapters?: boolean;
  imageAdapterPath?: string;
  workspaceDim?: number;
  useLLMPlanner?: boolean;
  llmUrl?: string;
  llmModel?: string;
}

export class ThalamusPipeline {
  private readonly useTrainedAdapters: boolean;
  private readonly workspaceDim: number;
  private readonly imageAdapterPath: string;
  private readonly planner: LLMPlanner | null;
  private imageAdapter: LinearAdapter | null = null;

  constructor(
    private readonly encoder: RealEncoderClient,
    options: ThalamusPipelineOptions = {},
  ) {
    this.useTrainedAdapters = options.useTrainedAdapters ?? true;
    this.workspaceDim = options.workspaceDim ?? 512;
    this.imageAdapterPath =
      options.imageAdapterPath ??
      path.resolve(process.cwd(), "adapters/image_to_workspace.npy");
    this.planner =
      options.useLLMPlanner === true
        ? new LLMPlanner({
            url: options.llmUrl,
            model: options.llmModel ?? "phi3:mini",
          })
        : null;
  }

  async run(input: PipelineInput): Promise<PipelineResult> {
    const started = performance.now();
    const stages: StageMetric[] = [];

    const visionVector = await timeStage(stages, "vision_encode", () =>
      this.encoder.encode("vision", input.imageBytes),
    );
    const workspaceVector = await timeStage(stages, "image_to_workspace", () =>
      Promise.resolve(this.projectVision(visionVector)),
    );
    const responseText = await timeStage(stages, "planner_stub", () =>
      this.plan(workspaceVector, input.question),
    );
    const outputVector = answerEmbedding(responseText);

    return {
      pipeline: "thalamus",
      inputId: input.inputId,
      questionId: input.questionId,
      responseText,
      outputVector,
      latency_ms: performance.now() - started,
      token_count: 0,
      vector_dim: workspaceVector.length,
      stages,
      metadata: {
        adapter: this.useTrainedAdapters ? "linear-npy" : "phase1-random",
        vision_dim: visionVector.length,
        workspace_dim: workspaceVector.length,
      },
    };
  }

  private projectVision(visionVector: Float32Array): Float32Array {
    if (this.useTrainedAdapters) {
      this.imageAdapter ??= new LinearAdapter({
        weightPath: this.imageAdapterPath,
        sourceDim: visionVector.length,
        targetDim: this.workspaceDim,
        allowIdentityFallback: true,
      });
      return this.imageAdapter.project_to_workspace(
        visionVector,
        this.workspaceDim,
      );
    }

    return new VisionStubAdapter(visionVector.length).project_to_workspace(
      visionVector,
      this.workspaceDim,
    );
  }

  private plan(
    workspaceVector: Float32Array,
    question: string,
  ): Promise<string> {
    if (this.planner !== null) {
      return this.planner.planFromVector(workspaceVector, question);
    }

    return Promise.resolve(
      answerQuestionFromWorkspace(workspaceVector, question),
    );
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
