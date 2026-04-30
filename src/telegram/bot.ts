import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RealEncoderClient } from "../encoders/realEncoderClient.js";
import { ResultsStore } from "../experiments/resultsStore.js";
import { answerEmbedding, isCorrectAnswer } from "../pipelines/plannerStub.js";
import { TextBusPipeline } from "../pipelines/textBusPipeline.js";
import { ThalamusPipeline } from "../pipelines/thalamusPipeline.js";
import type { PipelineInput, PipelineResult } from "../pipelines/types.js";
import { cosineSimilarity } from "../vector.js";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: Array<{ file_id: string }>;
  voice?: { file_id: string };
}

interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path: string };
  description?: string;
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (
  process.env.THALAMUS_BOT_SMOKE === "1" ||
  token === undefined ||
  token.length === 0
) {
  console.log(
    "thalamus telegram bot mock mode: no TELEGRAM_BOT_TOKEN required",
  );
  await runMockSmoke();
} else {
  await runTelegramBot(token);
}

async function runMockSmoke(): Promise<void> {
  const dir = path.resolve(process.cwd(), "experiments/inputs/telegram-smoke");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "payload.txt"),
    "telegram smoke payload for thalamus phase 2\n",
  );
}

async function runTelegramBot(botToken: string): Promise<void> {
  let offset = 0;
  console.log("thalamus telegram bot started");

  for (;;) {
    const updates = await telegram<TelegramUpdate[]>(botToken, "getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message !== undefined) {
        await handleMessage(botToken, update.message);
      }
    }
  }
}

async function handleMessage(
  botToken: string,
  message: TelegramMessage,
): Promise<void> {
  const payload = await downloadPayload(botToken, message);
  const input = await buildTelegramInput(message, payload);
  const encoder = new RealEncoderClient();
  const store = new ResultsStore();
  const textBus = new TextBusPipeline(encoder);
  const thalamus = new ThalamusPipeline(encoder, { useTrainedAdapters: true });

  try {
    const textResult = await textBus.run(input);
    const thalamusResult = await thalamus.run(input);
    const textMetric = record(store, textResult, input.expectedAnswer);
    const thalamusMetric = record(store, thalamusResult, input.expectedAnswer);

    await telegram(botToken, "sendMessage", {
      chat_id: message.chat.id,
      text: [
        `text-bus  : ${textResult.latency_ms.toFixed(1)}ms, ${textResult.token_count}, ${textMetric.fidelity.toFixed(3)}`,
        `thalamus  : ${thalamusResult.latency_ms.toFixed(1)}ms, 0,        ${thalamusMetric.fidelity.toFixed(3)}`,
      ].join("\n"),
    });
  } finally {
    encoder.close();
    store.close();
  }
}

function record(
  store: ResultsStore,
  result: PipelineResult,
  expectedAnswer: string,
): { fidelity: number; success: boolean } {
  const target = answerEmbedding(expectedAnswer);
  const fidelity = cosineSimilarity(result.outputVector, target);
  const success = isCorrectAnswer(result.responseText, expectedAnswer);
  store.insert(result, {
    source: "telegram",
    expectedAnswer,
    fidelity,
    taskSuccess: success,
  });
  return { fidelity, success };
}

async function buildTelegramInput(
  message: TelegramMessage,
  payload: Buffer,
): Promise<PipelineInput> {
  const dir = path.resolve(
    process.cwd(),
    "experiments/inputs",
    String(message.message_id),
  );
  await mkdir(dir, { recursive: true });
  const imagePath = path.join(dir, "payload.ppm");
  const bytes = payload.length > 0 ? payload : Buffer.from(message.text ?? "");
  await writeFile(imagePath, bytes);

  return {
    inputId: `telegram-${message.message_id}`,
    questionId: "telegram-q1",
    imagePath,
    imageBytes: await readFile(imagePath),
    question: "What is in the image?",
    expectedAnswer: "unknown object",
    metadata: {
      color: "unknown",
      shape: "object",
    },
  };
}

async function downloadPayload(
  botToken: string,
  message: TelegramMessage,
): Promise<Buffer> {
  if (message.text !== undefined) {
    return Buffer.from(message.text, "utf8");
  }

  const fileId = message.voice?.file_id ?? message.photo?.at(-1)?.file_id;
  if (fileId === undefined) {
    return Buffer.alloc(0);
  }

  const file = await telegramFile(botToken, fileId);
  const response = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
  );
  return Buffer.from(await response.arrayBuffer());
}

async function telegramFile(
  botToken: string,
  fileId: string,
): Promise<{ file_path: string }> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const body = (await response.json()) as TelegramFileResponse;
  if (!body.ok || body.result === undefined) {
    throw new Error(body.description ?? "Telegram getFile failed");
  }
  return body.result;
}

async function telegram<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!body.ok || body.result === undefined) {
    throw new Error(body.description ?? `Telegram ${method} failed`);
  }
  return body.result;
}
