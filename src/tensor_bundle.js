import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config.js";
import { sha256 } from "./system.js";

export const TENSOR_BUNDLE_DIR = path.join(STATE_DIR, "tensor_bundles");

function nowIso() { return new Date().toISOString(); }
function idFor(vector) { return `tb_${nowIso().replace(/[-:.TZ]/g, "").slice(0, 14)}_${sha256(JSON.stringify(vector).slice(0, 20000)).slice(0, 12)}`; }
function f16ToFloat32(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x03ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
function float32ToF16(val) {
  if (!Number.isFinite(val)) return val < 0 ? 0xfc00 : 0x7c00;
  const s = val < 0 ? 0x8000 : 0;
  let x = Math.abs(val);
  if (x === 0) return s;
  let e = Math.floor(Math.log2(x));
  let m = x / Math.pow(2, e) - 1;
  let he = e + 15;
  if (he <= 0) return s | Math.max(0, Math.min(0x3ff, Math.round(x / Math.pow(2, -24))));
  if (he >= 31) return s | 0x7c00;
  return s | (he << 10) | Math.max(0, Math.min(0x3ff, Math.round(m * 1024)));
}
function encodeF16(vector) {
  const buf = Buffer.alloc(vector.length * 2);
  vector.forEach((v, i) => buf.writeUInt16LE(float32ToF16(Number(v)), i * 2));
  return buf;
}
function decodeF16(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += 2) out.push(f16ToFloat32(buf.readUInt16LE(i)));
  return out;
}
export async function saveTensorBundle(input = {}) {
  await fs.mkdir(TENSOR_BUNDLE_DIR, { recursive: true });
  const vector = (input.vector || []).map(Number);
  if (!vector.length) return { ok: false, error: "vector required" };
  const id = input.tensor_bundle_id || input.id || idFor(vector);
  const payload = encodeF16(vector);
  if (payload.length > 1024 * 1024) return { ok: false, error: "tensor bundle exceeds 1MB" };
  const meta = {
    id,
    created_at: nowIso(),
    promoted: Boolean(input.promoted),
    vector_dim: vector.length,
    dtype: "float16",
    namespace: input.namespace || input.inline_vector_namespace || null,
    model: input.model || input.inline_vector_model || null,
    referenced_by_atoms: input.referenced_by_atoms || [],
    expires_at: input.promoted ? null : new Date(Date.now() + 30 * 86400_000).toISOString(),
    payload_file: `${id}.f16`,
    bytes: payload.length,
  };
  await fs.writeFile(path.join(TENSOR_BUNDLE_DIR, `${id}.f16`), payload);
  await fs.writeFile(path.join(TENSOR_BUNDLE_DIR, `${id}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, tensor_bundle_id: id, metadata: meta };
}
export async function loadTensorBundle(id) {
  if (!/^tb_[A-Za-z0-9_:-]+$/.test(String(id || ""))) return { ok: false, error: "invalid tensor_bundle_id" };
  const metaPath = path.join(TENSOR_BUNDLE_DIR, `${id}.json`);
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  const buf = await fs.readFile(path.join(TENSOR_BUNDLE_DIR, meta.payload_file || `${id}.f16`));
  return { ok: true, tensor_bundle_id: id, metadata: meta, vector: decodeF16(buf) };
}
