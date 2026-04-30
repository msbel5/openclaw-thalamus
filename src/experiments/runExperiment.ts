import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RealEncoderClient } from "../encoders/realEncoderClient.js";
import { TextBusPipeline } from "../pipelines/textBusPipeline.js";
import { ThalamusPipeline } from "../pipelines/thalamusPipeline.js";
import type { PipelineInput, PipelineResult } from "../pipelines/types.js";
import { answerEmbedding, isCorrectAnswer } from "../pipelines/plannerStub.js";
import { cosineSimilarity } from "../vector.js";
import { loadControlledInputs } from "./controlledInputs.js";
import { ResultsStore, summaryToCsv } from "./resultsStore.js";

export interface ExperimentRunOptions {
  source?: string;
  limit?: number;
  reset?: boolean;
  resultsPath?: string;
  summaryPath?: string;
  inputsDir?: string;
}

export async function runExperiment(
  options: ExperimentRunOptions = {},
): Promise<ReturnType<ResultsStore["summaries"]>> {
  const inputs = await loadControlledInputs(options.inputsDir);
  const selected =
    options.limit === undefined ? inputs : inputs.slice(0, options.limit);
  const encoder = new RealEncoderClient();
  const textBus = new TextBusPipeline(encoder);
  const thalamus = new ThalamusPipeline(encoder, {
    useTrainedAdapters: true,
  });
  const resultStem =
    process.env.THALAMUS_INPUTS === "real" ? "results-real" : "results-fixture";
  const store = new ResultsStore(
    options.resultsPath ??
      path.resolve(process.cwd(), "experiments", `${resultStem}.sqlite`),
  );

  if (options.reset ?? true) {
    store.reset();
  }

  try {
    for (const input of selected) {
      recordPipelineResult(
        store,
        await textBus.run(input),
        input,
        options.source ?? "controlled",
      );
      recordPipelineResult(
        store,
        await thalamus.run(input),
        input,
        options.source ?? "controlled",
      );
    }

    const summaries = store.summaries();
    const summaryPath = resolveSummaryPath(
      options.resultsPath,
      options.summaryPath,
      resultStem,
    );
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, summaryToCsv(summaries));
    return summaries;
  } finally {
    encoder.close();
    store.close();
  }
}

function recordPipelineResult(
  store: ResultsStore,
  result: PipelineResult,
  input: PipelineInput,
  source: string,
): void {
  const target = answerEmbedding(input.expectedAnswer);
  store.insert(result, {
    source,
    expectedAnswer: input.expectedAnswer,
    fidelity: cosineSimilarity(result.outputVector, target),
    taskSuccess: isCorrectAnswer(result.responseText, input.expectedAnswer),
  });
}

function resolveSummaryPath(
  resultsPath: string | undefined,
  summaryPath: string | undefined,
  resultStem: string,
): string {
  if (summaryPath !== undefined) {
    return summaryPath;
  }

  if (resultsPath === undefined) {
    return path.resolve(process.cwd(), "experiments", `${resultStem}.csv`);
  }

  const parsed = path.parse(resultsPath);
  const filename =
    parsed.ext.length === 0
      ? `${parsed.base}.csv`
      : `${parsed.name}${parsed.ext === ".sqlite" ? "" : parsed.ext}.csv`;

  return path.join(parsed.dir, filename);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const limit =
    process.env.THALAMUS_EXPERIMENT_LIMIT === undefined
      ? undefined
      : Number(process.env.THALAMUS_EXPERIMENT_LIMIT);
  const summaries = await runExperiment({ limit });
  console.log(JSON.stringify({ summaries }, null, 2));
}
