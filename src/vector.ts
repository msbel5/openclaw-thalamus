export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      "cosine similarity requires vectors with matching dimensions",
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;

  for (const value of vector) {
    norm += value * value;
  }

  if (norm === 0) {
    return vector;
  }

  const scale = 1 / Math.sqrt(norm);

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) * scale;
  }

  return vector;
}
