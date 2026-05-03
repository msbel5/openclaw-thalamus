import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VIDEO_FRAME_FPS, VIDEO_MAX_FRAMES } from "./config.js";
import { embed } from "./vector_store.js";
import { makePacketId, savePacket } from "./packet_store.js";
import { pathExists, runFile } from "./system.js";

function compactStored(stored = []) {
  return stored.map((row) => ({
    id: row.id,
    packet_id: row.packet_id,
    namespace: row.namespace,
    vector_dim: row.vector_dim,
    source: row.source,
    intent: row.intent
  }));
}

function vectorDims(embeddings = []) {
  const out = {};
  for (const item of embeddings) {
    out[item.namespace] = item.vector_dim;
  }
  return out;
}

async function saveIngestPacket({ packetId, task, source, intent, metadata, parentPacketId, embedResult, childPacketIds = [] }) {
  const packet = await savePacket({
    packet_id: packetId,
    task,
    kind: "ingest",
    generated_at: new Date().toISOString(),
    source,
    intent,
    parent_packet_id: parentPacketId || null,
    metadata: metadata || {},
    vector_refs: compactStored(embedResult.stored),
    vector_dims: vectorDims(embedResult.embeddings),
    stored_namespaces: [...new Set(embedResult.embeddings.map((item) => item.namespace))],
    degraded: Boolean(embedResult.degraded),
    warnings: embedResult.warnings || [],
    proof: embedResult.proof || {},
    child_packet_ids: childPacketIds
  });
  return packet;
}

async function ingestOne(input, forcedPacketId = null) {
  const source = input.source || "manual";
  const intent = input.intent || "ingest";
  const metadata = input.metadata || {};
  const parentPacketId = input.parent_packet_id || input.parentPacketId || null;
  const task = `ingest:${source}:${intent}:${input.text || input.audio_path || input.image_path || "multimodal"}`;
  const packetId = forcedPacketId || makePacketId(task, JSON.stringify(metadata));
  const embedResult = await embed({
    text: input.text,
    audio_path: input.audio_path,
    image_path: input.image_path,
    namespace: input.namespace || "atoms.memory",
    store: true,
    source,
    intent,
    parent_packet_id: parentPacketId,
    packet_id: packetId,
    metadata
  });
  const packet = await saveIngestPacket({
    packetId,
    task,
    source,
    intent,
    metadata,
    parentPacketId,
    embedResult
  });
  return {
    ok: embedResult.ok,
    packet_id: packet.packet_id,
    resolver_key: packet.resolver_key,
    vector_dims: packet.vector_dims,
    stored_namespaces: packet.stored_namespaces,
    vector_refs: packet.vector_refs,
    proof: packet.proof,
    child_packet_ids: []
  };
}

async function extractVideo(videoPath, tempDir) {
  const framesDir = path.join(tempDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const framePattern = path.join(framesDir, "frame_%03d.png");
  await runFile("ffmpeg", [
    "-y",
    "-nostdin",
    "-i",
    videoPath,
    "-vf",
    `fps=${VIDEO_FRAME_FPS}`,
    "-frames:v",
    String(VIDEO_MAX_FRAMES),
    framePattern
  ], { timeout: 120_000 });
  const frames = (await fs.readdir(framesDir).catch(() => []))
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => path.join(framesDir, name));

  const audioPath = path.join(tempDir, "audio.wav");
  const audioResult = await runFile(
    "ffmpeg",
    ["-y", "-nostdin", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", audioPath],
    { timeout: 120_000 }
  );
  const audio = audioResult.ok && (await pathExists(audioPath)) ? audioPath : null;
  return { frames, audio };
}

async function ingestVideo(input) {
  const source = input.source || "manual";
  const intent = input.intent || "video-ingest";
  const metadata = input.metadata || {};
  const parentPacketId = input.parent_packet_id || input.parentPacketId || null;
  const videoPath = input.video_path || input.videoPath;
  if (!(await pathExists(videoPath))) {
    return { ok: false, error: `video_path not found: ${videoPath}` };
  }
  const task = `ingest:${source}:${intent}:${videoPath}`;
  const packetId = makePacketId(task, JSON.stringify(metadata));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "thalamus-video-"));
  const childPacketIds = [];
  const childResults = [];
  try {
    const extracted = await extractVideo(videoPath, tempDir);
    let index = 0;
    for (const frame of extracted.frames) {
      const result = await ingestOne({
        source: `${source}:frame:${index}`,
        intent: "video-frame",
        image_path: frame,
        metadata: { ...metadata, video_path: videoPath, frame_index: index },
        parent_packet_id: packetId
      });
      childPacketIds.push(result.packet_id);
      childResults.push(result);
      index += 1;
    }
    if (extracted.audio) {
      const result = await ingestOne({
        source: `${source}:audio`,
        intent: "video-audio",
        audio_path: extracted.audio,
        metadata: { ...metadata, video_path: videoPath },
        parent_packet_id: packetId
      });
      childPacketIds.push(result.packet_id);
      childResults.push(result);
    }
    const packet = await savePacket({
      packet_id: packetId,
      task,
      kind: "video_ingest_parent",
      generated_at: new Date().toISOString(),
      source,
      intent,
      parent_packet_id: parentPacketId || null,
      metadata: { ...metadata, video_path: videoPath, fps: VIDEO_FRAME_FPS, max_frames: VIDEO_MAX_FRAMES },
      child_packet_ids: childPacketIds,
      vector_refs: [],
      vector_dims: {},
      stored_namespaces: [],
      degraded: childResults.some((row) => row.proof?.degraded),
      proof: {
        extracted_frames: extracted.frames.length,
        extracted_audio: Boolean(extracted.audio),
        child_results: childResults.map((row) => ({
          packet_id: row.packet_id,
          stored_namespaces: row.stored_namespaces,
          vector_dims: row.vector_dims
        }))
      }
    });
    return {
      ok: childPacketIds.length > 0,
      packet_id: packet.packet_id,
      resolver_key: packet.resolver_key,
      vector_dims: packet.vector_dims,
      stored_namespaces: packet.stored_namespaces,
      proof: packet.proof,
      child_packet_ids: childPacketIds
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function ingest(input = {}) {
  if (input.video_path || input.videoPath) return ingestVideo(input);
  if (!input.text && !input.audio_path && !input.audioPath && !input.image_path && !input.imagePath) {
    return { ok: false, error: "thalamus_ingest requires text, audio_path, image_path, or video_path" };
  }
  return ingestOne({
    ...input,
    audio_path: input.audio_path || input.audioPath,
    image_path: input.image_path || input.imagePath
  });
}

