import { createHash } from "node:crypto";
import { normalizeVector } from "../vector.js";

export const CONTROLLED_COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "white",
  "black",
  "brown",
  "gray",
  "grey",
  "pink",
  "tan",
] as const;

export const CONTROLLED_SHAPES = [
  "square",
  "circle",
  "triangle",
  "diamond",
  "bar",
  "round",
  "rectangular",
  "rectangle",
  "oval",
  "cylindrical",
  "flat",
  "long",
] as const;

export function answerQuestionFromCaption(
  caption: string,
  question: string,
): string {
  const color = findKnownTerm(caption, CONTROLLED_COLORS) ?? "unknown";
  const shape = findKnownTerm(caption, CONTROLLED_SHAPES) ?? "object";
  return answerFromFacts(color, shape, question);
}

export function answerQuestionFromWorkspace(
  workspaceVector: Float32Array,
  question: string,
): string {
  const color = maxTerm(workspaceVector, 0, CONTROLLED_COLORS);
  const shape = maxTerm(workspaceVector, 16, CONTROLLED_SHAPES);
  return answerFromFacts(color, shape, question);
}

export function answerEmbedding(answer: string): Float32Array {
  const vector = new Float32Array(384);
  const normalized = normalizeAnswer(answer);

  for (const [index, color] of CONTROLLED_COLORS.entries()) {
    if (normalized.includes(color)) {
      vector[index] = 2;
    }
  }

  for (const [index, shape] of CONTROLLED_SHAPES.entries()) {
    if (normalized.includes(shape)) {
      vector[16 + index] = 2;
    }
  }

  if (normalized === "yes") {
    vector[32] = 2;
  } else if (normalized === "no") {
    vector[33] = 2;
  }

  const digest = createHash("sha256").update(normalized).digest();
  for (let index = 0; index < digest.length; index += 1) {
    vector[64 + index] = (digest[index] ?? 0) / 255 - 0.5;
  }

  return normalizeVector(vector);
}

export function isCorrectAnswer(actual: string, expected: string): boolean {
  return normalizeAnswer(actual) === normalizeAnswer(expected);
}

export function normalizeAnswer(answer: string): string {
  return answer.toLowerCase().trim().replace(/\s+/gu, " ");
}

export function countApproxTokens(text: string): number {
  return text.match(/[a-z0-9]+|[^\s]/giu)?.length ?? 0;
}

function answerFromFacts(
  color: string,
  shape: string,
  question: string,
): string {
  const normalizedQuestion = question.toLowerCase();

  if (
    normalizedQuestion.includes("what color") ||
    normalizedQuestion.includes("dominant color")
  ) {
    return color;
  }

  if (
    normalizedQuestion.includes("what shape") ||
    normalizedQuestion.includes("shape best describes")
  ) {
    return shape;
  }

  if (
    normalizedQuestion.includes("describe") ||
    normalizedQuestion.includes("what is in")
  ) {
    return `${color} ${shape}`;
  }

  const isMatch = /^is the object ([a-z]+)\?/u.exec(normalizedQuestion);
  if (isMatch !== null) {
    const queried = isMatch[1];
    return queried === color || queried === shape ? "yes" : "no";
  }

  return `${color} ${shape}`;
}

function findKnownTerm<const T extends readonly string[]>(
  text: string,
  terms: T,
): T[number] | null {
  const lowered = text.toLowerCase();
  for (const term of terms) {
    if (new RegExp(`\\b${term}\\b`, "u").test(lowered)) {
      return term;
    }
  }
  return null;
}

function maxTerm<const T extends readonly string[]>(
  vector: Float32Array,
  offset: number,
  terms: T,
): T[number] {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < terms.length; index += 1) {
    const value = vector[offset + index] ?? Number.NEGATIVE_INFINITY;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }

  const fallback = terms[0];
  if (fallback === undefined) {
    throw new Error("maxTerm requires at least one term");
  }

  return terms[bestIndex] ?? fallback;
}
