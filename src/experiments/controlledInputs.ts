import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PipelineInput } from "../pipelines/types.js";
import {
  CONTROLLED_COLORS,
  CONTROLLED_SHAPES,
} from "../pipelines/plannerStub.js";

interface QuestionSpec {
  id: string;
  question: string;
  expectedAnswer: string;
}

interface InputManifestItem {
  id: string;
  color: string;
  shape: string;
  imagePath: string;
  questions: QuestionSpec[];
}

export async function loadControlledInputs(
  inputsDir = path.resolve(process.cwd(), "experiments/inputs"),
): Promise<PipelineInput[]> {
  const mode = inputMode();
  if (mode === "real") {
    return loadRealInputs(path.join(inputsDir, "real"));
  }

  const ppmDir = path.join(inputsDir, "ppm");
  await ensureControlledInputs(ppmDir);
  const manifest = JSON.parse(
    await readFile(path.join(ppmDir, "manifest.json"), "utf8"),
  ) as { items: InputManifestItem[] };

  const inputs: PipelineInput[] = [];

  for (const item of manifest.items) {
    const imagePath = path.join(ppmDir, item.imagePath);
    const imageBytes = await readFile(imagePath);

    for (const question of item.questions) {
      inputs.push({
        inputId: item.id,
        questionId: question.id,
        imagePath,
        imageBytes,
        question: question.question,
        expectedAnswer: question.expectedAnswer,
        metadata: {
          color: item.color,
          shape: item.shape,
        },
      });
    }
  }

  return inputs;
}

function inputMode(): "ppm" | "real" {
  const value = process.env.THALAMUS_INPUTS?.toLowerCase();
  if (value === "ppm" || value === "real") {
    return value;
  }
  return process.env.NODE_ENV === "test" ? "ppm" : "real";
}

async function loadRealInputs(realDir: string): Promise<PipelineInput[]> {
  const manifestPath = path.join(realDir, "manifest.jsonl");
  const manifest = (await readFile(manifestPath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map(
      (line) => JSON.parse(line) as { id: string; image: string; qa: string },
    );
  const inputs: PipelineInput[] = [];

  for (const item of manifest) {
    const imagePath = path.resolve(realDir, item.image);
    const imageBytes = await readFile(imagePath);
    const qaPath = path.resolve(realDir, item.qa);
    const questions = (await readFile(qaPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            id: string;
            question: string;
            expectedAnswer: string;
            color?: string;
            shape?: string;
          },
      );

    for (const question of questions) {
      inputs.push({
        inputId: item.id,
        questionId: question.id,
        imagePath,
        imageBytes,
        question: question.question,
        expectedAnswer: question.expectedAnswer,
        metadata: {
          color: question.color ?? "",
          shape: question.shape ?? "",
        },
      });
    }
  }

  return inputs;
}

export async function ensureControlledInputs(inputsDir: string): Promise<void> {
  await mkdir(inputsDir, { recursive: true });
  const items: InputManifestItem[] = [];

  for (let index = 0; index < 50; index += 1) {
    const color =
      CONTROLLED_COLORS[index % CONTROLLED_COLORS.length] ??
      CONTROLLED_COLORS[0];
    const shape =
      CONTROLLED_SHAPES[
        Math.floor(index / CONTROLLED_COLORS.length) % CONTROLLED_SHAPES.length
      ] ?? CONTROLLED_SHAPES[0];
    const id = `fixture-${String(index + 1).padStart(2, "0")}`;
    const itemDir = path.join(inputsDir, id);
    await mkdir(itemDir, { recursive: true });

    const imageRelativePath = `${id}/image.ppm`;
    await writeFile(
      path.join(inputsDir, imageRelativePath),
      createPpmImage(color, shape),
    );

    const negativeColor =
      CONTROLLED_COLORS[(index + 3) % CONTROLLED_COLORS.length] ?? "red";
    const questions: QuestionSpec[] = [
      {
        id: "q1",
        question: "What color is the object?",
        expectedAnswer: color,
      },
      {
        id: "q2",
        question: "What shape is the object?",
        expectedAnswer: shape,
      },
      {
        id: "q3",
        question: `Is the object ${index % 2 === 0 ? color : negativeColor}?`,
        expectedAnswer: index % 2 === 0 ? "yes" : "no",
      },
      {
        id: "q4",
        question: "Describe the object.",
        expectedAnswer: `${color} ${shape}`,
      },
      {
        id: "q5",
        question: "What is in the image?",
        expectedAnswer: `${color} ${shape}`,
      },
    ];

    await writeFile(
      path.join(itemDir, "questions.json"),
      `${JSON.stringify(questions, null, 2)}\n`,
    );

    items.push({
      id,
      color,
      shape,
      imagePath: imageRelativePath,
      questions,
    });
  }

  await writeFile(
    path.join(inputsDir, "manifest.json"),
    `${JSON.stringify({ generated_by: "openclaw-thalamus-phase2", items }, null, 2)}\n`,
  );
}

function createPpmImage(color: string, shape: string): Buffer {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3, 0);
  const rgb = colorToRgb(color);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (insideShape(shape, x, y, width, height)) {
        const offset = (y * width + x) * 3;
        pixels[offset] = rgb[0];
        pixels[offset + 1] = rgb[1];
        pixels[offset + 2] = rgb[2];
      }
    }
  }

  return Buffer.concat([
    Buffer.from(
      `P6\n# color=${color} shape=${shape}\n${width} ${height}\n255\n`,
      "ascii",
    ),
    pixels,
  ]);
}

function colorToRgb(color: string): [number, number, number] {
  switch (color) {
    case "red":
      return [220, 48, 48];
    case "blue":
      return [48, 96, 220];
    case "green":
      return [56, 160, 88];
    case "yellow":
      return [224, 196, 48];
    case "purple":
      return [144, 80, 192];
    case "orange":
      return [232, 128, 48];
    case "white":
      return [230, 230, 230];
    case "black":
      return [16, 16, 16];
    default:
      return [200, 200, 200];
  }
}

function insideShape(
  shape: string,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const cx = width / 2;
  const cy = height / 2;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);

  switch (shape) {
    case "square":
      return dx <= 18 && dy <= 18;
    case "circle":
      return dx * dx + dy * dy <= 19 * 19;
    case "triangle":
      return y >= 16 && y <= 50 && dx <= (y - 16) * 0.58;
    case "diamond":
      return dx + dy <= 22;
    case "bar":
      return dx <= 6 && dy <= 24;
    default:
      return dx <= 18 && dy <= 18;
  }
}
