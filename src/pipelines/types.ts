export type PipelineName = "text-bus" | "thalamus";

export interface PipelineInput {
  inputId: string;
  questionId: string;
  imagePath: string;
  imageBytes: Buffer;
  question: string;
  expectedAnswer: string;
  metadata: {
    color: string;
    shape: string;
  };
}

export interface StageMetric {
  name: string;
  latency_ms: number;
}

export interface PipelineResult {
  pipeline: PipelineName;
  inputId: string;
  questionId: string;
  responseText: string;
  outputVector: Float32Array;
  latency_ms: number;
  token_count: number;
  vector_dim: number;
  stages: StageMetric[];
  metadata: Record<string, unknown>;
}
