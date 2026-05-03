import fs from "node:fs/promises";
import path from "node:path";
import { PACKET_DIR, PACKET_MAX_COUNT, PACKET_TTL_DAYS, STATE_DIR } from "./config.js";
import { appendJsonl, ensureDirs, pathExists, readJsonSafe, sha256, writeJson } from "./system.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        if (key !== "resolver_key") out[key] = canonical(value[key]);
        return out;
      }, {});
  }
  return value;
}

export function resolverKeyFor(packet) {
  return `sha256:${sha256(JSON.stringify(canonical(packet)))}`;
}

export function taskHash(task) {
  return sha256(String(task || "").trim().toLowerCase()).slice(0, 24);
}

export function makePacketId(task, extra = "") {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `pkt_${now}_${sha256(`${task}\n${extra}`).slice(0, 12)}`;
}

export async function listPackets() {
  await ensureDirs();
  const entries = await fs.readdir(PACKET_DIR, { withFileTypes: true }).catch(() => []);
  const packets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(PACKET_DIR, entry.name);
    const stat = await fs.stat(file).catch(() => null);
    const packet = await readJsonSafe(file, null);
    if (packet) packets.push({ file, stat, packet });
  }
  return packets.sort((a, b) => String(b.packet.generated_at).localeCompare(String(a.packet.generated_at)));
}

export async function findCachedPacket(task) {
  const hash = taskHash(task);
  for (const row of await listPackets()) {
    if (!row.packet.promoted && row.packet.task_hash === hash) {
      return row.packet;
    }
  }
  return null;
}

export async function savePacket(packet, options = {}) {
  await ensureDirs();
  const saved = {
    ...packet,
    task_hash: packet.task_hash || taskHash(packet.task),
    expires_at:
      packet.promoted || options.promoted
        ? null
        : new Date(Date.now() + PACKET_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    promoted: Boolean(packet.promoted || options.promoted)
  };
  saved.resolver_key = resolverKeyFor(saved);
  const file = path.join(PACKET_DIR, `${saved.packet_id}.json`);
  await writeJson(file, saved);
  await appendJsonl(path.join(STATE_DIR, "packet_events.jsonl"), {
    ts: new Date().toISOString(),
    event: "save",
    packet_id: saved.packet_id,
    promoted: saved.promoted,
    task_hash: saved.task_hash,
    resolver_key: saved.resolver_key
  });
  return saved;
}

export async function resolvePacket(packetId, resolverKey) {
  if (!/^(pkt_|thalamus-)[A-Za-z0-9_:-]+$/.test(String(packetId || ""))) {
    return { ok: false, error: "invalid packet_id" };
  }
  const file = path.join(PACKET_DIR, `${packetId}.json`);
  if (!(await pathExists(file))) return { ok: false, error: "packet not found", packet_id: packetId };
  const packet = await readJsonSafe(file, null);
  if (!packet) return { ok: false, error: "packet parse failed", packet_id: packetId };
  if (resolverKey && packet.resolver_key !== resolverKey) {
    return { ok: false, error: "resolver_key mismatch", packet_id: packetId };
  }
  return { ok: true, packet_id: packetId, resolver_key: packet.resolver_key, packet };
}

export async function promotePacket(packetId, resolverKey, metadata = {}) {
  const resolved = await resolvePacket(packetId, resolverKey);
  if (!resolved.ok) return resolved;
  const packet = {
    ...resolved.packet,
    promoted: true,
    expires_at: null,
    promoted_at: new Date().toISOString(),
    promote_metadata: metadata
  };
  return { ok: true, packet: await savePacket(packet, { promoted: true }) };
}

export async function cleanupPackets() {
  await ensureDirs();
  const now = Date.now();
  const packets = await listPackets();
  let removed = 0;
  for (const row of packets) {
    if (row.packet.promoted) continue;
    const expires = row.packet.expires_at ? Date.parse(row.packet.expires_at) : null;
    if (expires && expires < now) {
      await fs.rm(row.file, { force: true });
      removed += 1;
    }
  }
  const afterTtl = (await listPackets()).filter((row) => !row.packet.promoted);
  if (afterTtl.length > PACKET_MAX_COUNT) {
    for (const row of afterTtl.slice(PACKET_MAX_COUNT)) {
      await fs.rm(row.file, { force: true });
      removed += 1;
    }
  }
  return {
    ok: true,
    removed,
    ttl_days: PACKET_TTL_DAYS,
    max_packets: PACKET_MAX_COUNT,
    count: (await listPackets()).length
  };
}

export async function getPacketStats() {
  const packets = await listPackets();
  return {
    ok: true,
    path: PACKET_DIR,
    count: packets.length,
    promoted: packets.filter((row) => row.packet.promoted).length,
    ttl_days: PACKET_TTL_DAYS,
    max_packets: PACKET_MAX_COUNT,
    latest: packets[0]
      ? {
          packet_id: packets[0].packet.packet_id,
          generated_at: packets[0].packet.generated_at,
          task: String(packets[0].packet.task || "").slice(0, 120)
        }
      : null
  };
}
