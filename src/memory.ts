import { createRequire } from "node:module";
import type { Database as DatabaseHandle } from "better-sqlite3";
import type { ThalamusPacket } from "./packet.js";
import { cosineSimilarity } from "./vector.js";

export interface MemoryHit {
  packet_id: string;
  summary: string;
  vector: Float32Array;
  score: number;
  timestamp: number;
}

export interface TieredMemoryOptions {
  hotMaxEntries?: number;
  sqlitePath?: string;
}

interface EpisodeRow {
  id: number;
  ts: number;
  summary: string;
  packet_id: string;
}

interface EpisodeStore {
  insert(ts: number, summary: string, packetId: string): void;
  latestByPacket(packetId: string): EpisodeRow | undefined;
  all(): EpisodeRow[];
  count(): number;
}

interface VectorEntry {
  packet_id: string;
  vector: Float32Array;
}

export class TieredMemory {
  private readonly hot = new Map<string, ThalamusPacket>();
  private readonly hotMaxEntries: number;
  private readonly episodes: EpisodeStore;
  private readonly vectorIndex: VectorEntry[] = [];

  constructor(options: TieredMemoryOptions = {}) {
    this.hotMaxEntries = options.hotMaxEntries ?? 1000;

    if (!Number.isInteger(this.hotMaxEntries) || this.hotMaxEntries <= 0) {
      throw new Error("hotMaxEntries must be a positive integer");
    }

    this.episodes = createEpisodeStore(options.sqlitePath ?? ":memory:");
  }

  store(packet: ThalamusPacket, summary = ""): Promise<void> {
    this.rememberHot(packet);
    this.episodes.insert(packet.timestamp, summary, packet.id);
    this.vectorIndex.push({
      packet_id: packet.id,
      vector: new Float32Array(packet.vector),
    });

    return Promise.resolve();
  }

  retrieveByText(query: string, k: number): Promise<MemoryHit[]> {
    const limit = normalizeLimit(k);
    const rows = this.allEpisodes();
    const normalizedQuery = normalizeText(query);
    const queryTerms = tokenize(normalizedQuery);

    const hits = rows
      .map((row) => ({
        row,
        score: scoreText(row.summary, normalizedQuery, queryTerms),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.row.ts - a.row.ts)
      .slice(0, limit)
      .map((hit) => this.toMemoryHit(hit.row, hit.score))
      .filter((hit): hit is MemoryHit => hit !== null);

    return Promise.resolve(hits);
  }

  retrieveById(packetId: string): Promise<MemoryHit | null> {
    const row = this.episodes.latestByPacket(packetId);

    if (row === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.toMemoryHit(row, 1));
  }

  retrieveRecent(k: number): Promise<MemoryHit[]> {
    const limit = normalizeLimit(k);
    const hits = this.allEpisodes()
      .slice(0, limit)
      .map((row) => this.toMemoryHit(row, 1))
      .filter((hit): hit is MemoryHit => hit !== null);

    return Promise.resolve(hits);
  }

  retrieveByVector(vec: Float32Array, k: number): Promise<MemoryHit[]> {
    const limit = normalizeLimit(k);
    const episodeByPacket = new Map(
      this.allEpisodes().map((row) => [row.packet_id, row]),
    );

    const hits = this.vectorIndex
      .map((entry) => {
        const row = episodeByPacket.get(entry.packet_id);
        if (row === undefined) {
          return null;
        }

        return this.toMemoryHit(row, cosineSimilarity(entry.vector, vec));
      })
      .filter((hit): hit is MemoryHit => hit !== null)
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
      .slice(0, limit);

    return Promise.resolve(hits);
  }

  size(): { hot: number; episodic: number; vector: number } {
    return {
      hot: this.hot.size,
      episodic: this.episodes.count(),
      vector: this.vectorIndex.length,
    };
  }

  private rememberHot(packet: ThalamusPacket): void {
    if (this.hot.has(packet.id)) {
      this.hot.delete(packet.id);
    }

    this.hot.set(packet.id, clonePacket(packet));

    while (this.hot.size > this.hotMaxEntries) {
      const oldest = this.hot.keys().next().value;
      if (oldest === undefined) {
        return;
      }

      this.hot.delete(oldest);
    }
  }

  private allEpisodes(): EpisodeRow[] {
    return this.episodes.all();
  }

  private toMemoryHit(row: EpisodeRow, score: number): MemoryHit | null {
    const vectorEntry = findLatestVector(this.vectorIndex, row.packet_id);
    if (vectorEntry === null) {
      return null;
    }

    return {
      packet_id: row.packet_id,
      summary: row.summary,
      vector: new Float32Array(vectorEntry.vector),
      score,
      timestamp: row.ts,
    };
  }
}

type DatabaseConstructor = new (path: string) => DatabaseHandle;

class SqliteEpisodeStore implements EpisodeStore {
  private readonly db: DatabaseHandle;

  constructor(sqlitePath: string, Database: DatabaseConstructor) {
    this.db = new Database(sqlitePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        summary TEXT NOT NULL,
        packet_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS episodes_packet_id_idx ON episodes(packet_id);
      CREATE INDEX IF NOT EXISTS episodes_summary_idx ON episodes(summary);
    `);
  }

  insert(ts: number, summary: string, packetId: string): void {
    this.db
      .prepare("INSERT INTO episodes (ts, summary, packet_id) VALUES (?, ?, ?)")
      .run(ts, summary, packetId);
  }

  latestByPacket(packetId: string): EpisodeRow | undefined {
    return this.db
      .prepare(
        "SELECT id, ts, summary, packet_id FROM episodes WHERE packet_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
      )
      .get(packetId) as EpisodeRow | undefined;
  }

  all(): EpisodeRow[] {
    return this.db
      .prepare(
        "SELECT id, ts, summary, packet_id FROM episodes ORDER BY ts DESC, id DESC",
      )
      .all() as EpisodeRow[];
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM episodes")
      .get() as { count: number };

    return row.count;
  }
}

class InMemoryEpisodeStore implements EpisodeStore {
  private readonly rows: EpisodeRow[] = [];
  private nextId = 1;

  insert(ts: number, summary: string, packetId: string): void {
    this.rows.push({
      id: this.nextId,
      ts,
      summary,
      packet_id: packetId,
    });
    this.nextId += 1;
  }

  latestByPacket(packetId: string): EpisodeRow | undefined {
    return this.all().find((row) => row.packet_id === packetId);
  }

  all(): EpisodeRow[] {
    return [...this.rows].sort((a, b) => b.ts - a.ts || b.id - a.id);
  }

  count(): number {
    return this.rows.length;
  }
}

function createEpisodeStore(sqlitePath: string): EpisodeStore {
  const Database = loadBetterSqlite();

  if (Database !== null) {
    try {
      return new SqliteEpisodeStore(sqlitePath, Database);
    } catch {
      // Fall through to the in-memory store when the native binding is present
      // but built for a different Node ABI.
    }
  }

  process.emitWarning(
    "better-sqlite3 is unavailable; TieredMemory is using an in-memory episodic store.",
    { code: "THALAMUS_SQLITE_FALLBACK" },
  );

  return new InMemoryEpisodeStore();
}

function loadBetterSqlite(): DatabaseConstructor | null {
  const require = createRequire(import.meta.url);

  try {
    const imported = require("better-sqlite3") as unknown;
    if (isDatabaseConstructor(imported)) {
      return imported;
    }

    if (isModuleWithDefaultDatabase(imported)) {
      return imported.default;
    }
  } catch {
    return null;
  }

  return null;
}

function isDatabaseConstructor(value: unknown): value is DatabaseConstructor {
  return typeof value === "function";
}

function isModuleWithDefaultDatabase(
  value: unknown,
): value is { default: DatabaseConstructor } {
  return (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    isDatabaseConstructor(value.default)
  );
}

function clonePacket(packet: ThalamusPacket): ThalamusPacket {
  return {
    ...packet,
    vector: new Float32Array(packet.vector),
    metadata: { ...packet.metadata },
    ...(packet.audit === undefined ? {} : { audit: { ...packet.audit } }),
  };
}

function normalizeLimit(k: number): number {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error("k must be a positive integer");
  }

  return k;
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim();
}

function tokenize(value: string): string[] {
  return value.split(/[^a-z0-9]+/u).filter((token) => token.length > 0);
}

function scoreText(
  summary: string,
  normalizedQuery: string,
  queryTerms: string[],
): number {
  const normalizedSummary = normalizeText(summary);

  if (normalizedQuery.length === 0 || normalizedSummary.length === 0) {
    return 0;
  }

  let score = normalizedSummary.includes(normalizedQuery) ? 2 : 0;
  const summaryTerms = new Set(tokenize(normalizedSummary));

  for (const term of queryTerms) {
    if (summaryTerms.has(term)) {
      score += 1;
    }
  }

  return score;
}

function findLatestVector(
  entries: VectorEntry[],
  packet_id: string,
): VectorEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.packet_id === packet_id) {
      return entry;
    }
  }

  return null;
}
