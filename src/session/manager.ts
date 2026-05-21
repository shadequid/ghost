/**
 * SessionManager — JSONL-based session persistence.
 *
 * Each session is a JSONL file: metadata line + message lines.
 * Atomic writes via .tmp → rename.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Session, type SessionSummary } from "./session.js";
import type { Message } from "@earendil-works/pi-ai";

export class SessionManager {
  private readonly sessionsDir: string;
  private readonly cache = new Map<string, Session>();
  private readonly initializedFiles = new Set<string>();

  constructor(workspaceDir: string) {
    this.sessionsDir = join(workspaceDir, "sessions");
    this.ensureDir();
  }

  /** Get an existing session from cache/disk, or create a new one. */
  getOrCreate(key: string): Session {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const loaded = this.load(key);
    if (loaded) {
      loaded.onAppend = (msg) => this.appendEntry(key, msg);
      this.cache.set(key, loaded);
      return loaded;
    }

    const session = new Session({
      key,
      onAppend: (msg) => this.appendEntry(key, msg),
    });
    this.cache.set(key, session);
    return session;
  }

  /** Append a single message as one JSONL line. Crash-safe: writes immediately via appendFileSync. */
  appendEntry(key: string, message: Message): void {
    this.ensureDir();
    const path = this.getSessionPath(key);

    // Track initialization in-memory to avoid TOCTOU race on existsSync
    // and eliminate a filesystem check on every append.
    if (!this.initializedFiles.has(key)) {
      if (!existsSync(path)) {
        const meta = JSON.stringify({
          _type: "metadata",
          key,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastActiveAt: null,
          metadata: {},
          lastConsolidated: 0,
        });
        appendFileSync(path, meta + "\n");
      }
      this.initializedFiles.add(key);
    }

    appendFileSync(path, JSON.stringify(message) + "\n");
  }

  /** Persist session to JSONL. Atomic: writes .tmp then renames. */
  async save(session: Session): Promise<void> {
    this.ensureDir();
    const path = this.getSessionPath(session.key);
    const tmpPath = path + ".tmp";

    const lines: string[] = [];

    // Line 1: metadata
    lines.push(JSON.stringify({
      _type: "metadata",
      key: session.key,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      lastActiveAt: session.lastActiveAt?.toISOString() ?? null,
      metadata: session.metadata,
      lastConsolidated: session.lastConsolidated,
    }));

    // Lines 2+: messages
    for (const msg of session.messages) {
      lines.push(JSON.stringify(msg));
    }

    await Bun.write(tmpPath, lines.join("\n") + "\n");
    renameSync(tmpPath, path);
  }

  /** Remove session from cache (next getOrCreate will reload from disk). */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Delete session from cache and disk. */
  delete(key: string): void {
    this.cache.delete(key);
    this.initializedFiles.delete(key);
    const path = this.getSessionPath(key);
    try {
      unlinkSync(path);
    } catch {
      // File may not exist — that's fine
    }
  }

  /** List all sessions by scanning JSONL files (reads only metadata lines). */
  listSessions(): SessionSummary[] {
    if (!existsSync(this.sessionsDir)) return [];

    const files = readdirSync(this.sessionsDir).filter(f => f.endsWith(".jsonl"));
    const summaries: SessionSummary[] = [];

    for (const file of files) {
      try {
        const path = join(this.sessionsDir, file);
        const content = readFileSync(path, "utf-8");
        const firstLine = content.slice(0, content.indexOf("\n"));
        const meta = JSON.parse(firstLine);
        if (meta._type === "metadata") {
          summaries.push({
            key: meta.key,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            messageCount: content.split("\n").filter(Boolean).length - 1,
          });
        }
      } catch {
        // Skip malformed files
      }
    }

    return summaries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  private load(key: string): Session | null {
    const path = this.getSessionPath(key);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, "utf-8");
      if (!content) return null;

      // parseJsonlTolerant skips malformed lines and recovers the rest —
      // preserving the old split+JSON.parse behavior. See the helper's
      // doc-comment for why we use parseChunk instead of Bun.JSONL.parse.
      const records = parseJsonlTolerant(content);
      if (records.length === 0) return null;

      // `records[0]` is `unknown` — narrow before casting. If the first line
      // is a JSON primitive (`null`, `42`, `"hello"`) the file is not a valid
      // session, so return null cleanly instead of leaking a TypeError up
      // into the outer try/catch.
      const first = records[0];
      if (
        typeof first !== "object" ||
        first === null ||
        (first as { _type?: unknown })._type !== "metadata"
      ) {
        return null;
      }
      const meta = first as {
        key: string;
        createdAt: string;
        updatedAt: string;
        lastActiveAt?: string | null;
        metadata?: Record<string, unknown>;
        lastConsolidated?: number;
      };

      const messages = records.slice(1).filter(isMessageLike);

      // Compute lastActiveAt: prefer a valid persisted value, otherwise backfill
      // from the most-recent user message in the JSONL.
      //
      // Persisted metadata is only written once at file creation (always null)
      // and rewritten by SessionManager.save() during memory consolidation.
      // Between those points, in-memory lastActiveAt updates from user messages
      // are not flushed to the metadata line. So a falsy persisted value can
      // mean either "user genuinely never messaged" OR "we just haven't rewritten
      // the metadata yet" — backfilling from message history disambiguates
      // correctly in both cases.
      let lastActiveAt: Date | null = null;
      if (meta.lastActiveAt) {
        const d = new Date(meta.lastActiveAt);
        if (Number.isFinite(d.getTime())) lastActiveAt = d;
      }
      if (lastActiveAt === null) {
        // Reverse-index loop avoids allocating an array copy for large sessions.
        for (let i = messages.length - 1; i >= 0; i--) {
          if ((messages[i] as { role?: string }).role === "user") {
            const ts = (messages[i] as { timestamp?: number }).timestamp;
            lastActiveAt = new Date(ts ?? Date.parse(meta.updatedAt));
            break;
          }
        }
      }

      return new Session({
        key: meta.key,
        messages,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt),
        lastActiveAt,
        metadata: meta.metadata ?? {},
        lastConsolidated: meta.lastConsolidated ?? 0,
      });
    } catch {
      return null;
    }
  }

  private getSessionPath(key: string): string {
    return join(this.sessionsDir, safeFilename(key) + ".jsonl");
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}

/** Convert session key to a safe filename (replace non-alphanumeric with _). */
function safeFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Minimal structural guard for `Message`. Session files are written by Ghost
 * itself so full schema validation would be overkill; we just filter out
 * JSON primitives (`null`, numbers, strings) that could slip through
 * `parseJsonlTolerant` from a corrupted or partially-written file.
 */
function isMessageLike(value: unknown): value is Message {
  return typeof value === "object" && value !== null;
}

/**
 * Parse JSONL with tolerance for malformed lines. Uses `Bun.JSONL.parseChunk`
 * (SIMD-accelerated, zero-alloc on ASCII) and skips over any line that
 * fails to parse, continuing from the next newline. Preserves the "recover
 * as much as possible" behavior of the old split+JSON.parse loop.
 *
 * Notes:
 *  - `Bun.JSONL.parse` returns partial results up to the first error
 *    instead of throwing, so we always use `parseChunk` for tolerant reads.
 *  - The `start` offset argument to `parseChunk` behaves inconsistently on
 *    string input, so we re-slice each iteration. Session files are small,
 *    so the O(n²) slice cost is negligible in practice.
 */
function parseJsonlTolerant(content: string): unknown[] {
  const records: unknown[] = [];
  let offset = 0;
  while (offset < content.length) {
    const result = Bun.JSONL.parseChunk(content.slice(offset));
    records.push(...result.values);
    if (result.error) {
      // `result.read` is the count of bytes successfully parsed relative to
      // the slice — points at the start of the malformed line.
      const nl = content.indexOf("\n", offset + result.read);
      if (nl === -1) break;
      offset = nl + 1;
      continue;
    }
    offset += result.read;
    if (result.done) break;
    // No progress and no error → EOF without trailing newline. Try parsing
    // the remainder as a single record.
    const tail = content.slice(offset).trim();
    if (tail) {
      try {
        records.push(JSON.parse(tail));
      } catch {
        /* skip malformed tail */
      }
    }
    break;
  }
  return records;
}
