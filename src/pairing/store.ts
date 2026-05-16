import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { generateUniqueCode } from "./code.js";

const PAIRING_TTL_MS = 60 * 60 * 1000;
// Per-channel sanity ceiling — a malicious /pair burst from many fake senders
// shouldn't be allowed to exhaust storage, but the previous value (3) was a
// per-channel hard cap, so 3 fake senders could block all legitimate pairings.
// The real DoS protection is `PAIRING_PENDING_MAX_PER_SENDER` below; this
// stays as a global ceiling at a number that effectively never trips for
// honest users (H6).
const PAIRING_PENDING_MAX = 50;
// Per-sender cap — a single sender can have at most one pending request per
// channel. Repeat /pair from the same sender reuses the existing request
// (idempotent, matches grammY auto-retry semantics). H6.
const PAIRING_PENDING_MAX_PER_SENDER = 1;

export interface PairingRequestRow {
  channel: string;
  senderId: string;
  code: string;
  username: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface AllowlistEntry {
  channel: string;
  identity: string;
  identityKind: "id" | "username";
  /** Telegram handle (no `@`) captured at approve time. `null` for entries
   *  added before the column existed or via username-kind identity (where
   *  the identity itself is the handle). */
  displayName: string | null;
  addedAt: number;
}

interface RawRequestRow {
  channel: string;
  sender_id: string;
  code: string;
  username: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

interface RawAllowlistRow {
  channel: string;
  identity: string;
  identity_kind: string;
  display_name: string | null;
  added_at: number;
}

export type PairingStoreEvent =
  | { type: "created"; row: PairingRequestRow }
  | { type: "approved"; row: PairingRequestRow }
  | { type: "removed"; channel: string; code: string; reason: "rejected" | "expired" }
  | { type: "allowlist_removed"; channel: string; identity: string };

export type PairingStoreListener = (event: PairingStoreEvent) => void;

export class PairingStore {
  private readonly listeners = new Set<PairingStoreListener>();

  constructor(private readonly db: Database, private readonly logger: Logger) {}

  /** Register a listener for pairing lifecycle events (create / approve /
   *  remove). Returns an unsubscribe function. Listener exceptions are
   *  swallowed so one bad subscriber cannot break another or the caller. */
  onEvent(listener: PairingStoreListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: PairingStoreEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch (err) {
        this.logger.warn({ err, eventType: event.type }, "PairingStore listener threw");
      }
    }
  }

  upsertRequest(input: {
    channel: string;
    senderId: string;
    username?: string;
  }): { kind: "created"; code: string } | { kind: "existing"; code: string } | { kind: "limit_reached" } {
    const now = Date.now();
    let createdRow: PairingRequestRow | null = null;
    const txn = this.db.transaction((): { kind: "created"; code: string } | { kind: "existing"; code: string } | { kind: "limit_reached" } => {
      this.db.run("DELETE FROM pairing_requests WHERE expires_at <= ?", [now]);

      const existing = this.db
        .query<RawRequestRow, [string, string]>(
          "SELECT * FROM pairing_requests WHERE channel = ? AND sender_id = ?",
        )
        .get(input.channel, input.senderId);

      if (existing) {
        // Per-sender cap (PAIRING_PENDING_MAX_PER_SENDER = 1): always reuse
        // the existing request for repeat /pair from the same sender, never
        // allocate a fresh code. Idempotent under grammY auto-retry and
        // resilient against a single malicious sender hammering /pair (H6).
        this.db.run(
          "UPDATE pairing_requests SET last_seen_at = ?, username = COALESCE(?, username) WHERE channel = ? AND sender_id = ?",
          [now, input.username ?? null, input.channel, input.senderId],
        );
        return { kind: "existing", code: existing.code };
      }

      // Global per-channel ceiling — guards against storage exhaustion from
      // many distinct senders, but loose enough that honest pairing flows
      // never hit it (H6: previous cap of 3 was hostile to legitimate use).
      const count = this.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM pairing_requests WHERE channel = ?",
        )
        .get(input.channel)!.n;
      if (count >= PAIRING_PENDING_MAX) {
        return { kind: "limit_reached" };
      }

      const existingCodes = new Set(
        this.db
          .query<{ code: string }, []>("SELECT code FROM pairing_requests")
          .all()
          .map((r) => r.code),
      );
      const code = generateUniqueCode(existingCodes);
      const expiresAt = now + PAIRING_TTL_MS;
      this.db.run(
        `INSERT INTO pairing_requests (channel, sender_id, code, username, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.channel,
          input.senderId,
          code,
          input.username ?? null,
          now,
          now,
          expiresAt,
        ],
      );
      createdRow = {
        channel: input.channel,
        senderId: input.senderId,
        code,
        username: input.username ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      };
      return { kind: "created", code };
    });
    const result = txn();
    if (createdRow) this.emit({ type: "created", row: createdRow });
    return result;
  }

  listRequests(channel: string): PairingRequestRow[] {
    const now = Date.now();
    this.db.run("DELETE FROM pairing_requests WHERE expires_at <= ?", [now]);
    const rows = this.db
      .query<RawRequestRow, [string]>(
        "SELECT * FROM pairing_requests WHERE channel = ? ORDER BY created_at ASC",
      )
      .all(channel);
    return rows.map(toRequestRow);
  }

  approveRequest(
    channel: string,
    code: string,
  ): { id: string; entry: PairingRequestRow } | null {
    const now = Date.now();
    const txn = this.db.transaction(() => {
      this.db.run("DELETE FROM pairing_requests WHERE expires_at <= ?", [now]);
      const row = this.db
        .query<RawRequestRow, [string, string]>(
          "SELECT * FROM pairing_requests WHERE channel = ? AND code = ?",
        )
        .get(channel, code);
      if (!row) return null;
      this.db.run(
        "DELETE FROM pairing_requests WHERE channel = ? AND sender_id = ?",
        [row.channel, row.sender_id],
      );
      const kind = /^\d+$/.test(row.sender_id) ? "id" : "username";
      // Persist the Telegram handle so the UI can render @name instead of
      // the bare numeric ID. For username-kind identities the column is
      // redundant (identity already IS the handle) — store NULL.
      const displayName = kind === "id" ? row.username : null;
      this.db.run(
        `INSERT OR IGNORE INTO channel_allowlist
         (channel, identity, identity_kind, display_name, added_at)
         VALUES (?, ?, ?, ?, ?)`,
        [row.channel, row.sender_id, kind, displayName, now],
      );
      return { id: row.sender_id, entry: toRequestRow(row) };
    });
    const result = txn();
    if (result) this.emit({ type: "approved", row: result.entry });
    return result;
  }

  rejectRequest(channel: string, code: string): boolean {
    const result = this.db.run(
      "DELETE FROM pairing_requests WHERE channel = ? AND code = ?",
      [channel, code],
    );
    if (result.changes > 0) {
      this.emit({ type: "removed", channel, code, reason: "rejected" });
    }
    return result.changes > 0;
  }

  listAllowlist(channel: string): AllowlistEntry[] {
    const rows = this.db
      .query<RawAllowlistRow, [string]>(
        "SELECT * FROM channel_allowlist WHERE channel = ? ORDER BY added_at ASC",
      )
      .all(channel);
    return rows.map(toAllowlistEntry);
  }

  listAllowlistIdentities(channel: string): string[] {
    return this.db
      .query<{ identity: string }, [string]>(
        "SELECT identity FROM channel_allowlist WHERE channel = ?",
      )
      .all(channel)
      .map((r) => r.identity);
  }

  removeAllowlist(channel: string, identity: string): boolean {
    const result = this.db.run(
      "DELETE FROM channel_allowlist WHERE channel = ? AND identity = ?",
      [channel, identity],
    );
    if (result.changes > 0) {
      this.emit({ type: "allowlist_removed", channel, identity });
      return true;
    }
    return false;
  }

  /** Wipe every pending pair request for a channel. Used when disconnecting
   *  a channel with the intent to reset state. */
  clearRequests(channel: string): void {
    this.db.run("DELETE FROM pairing_requests WHERE channel = ?", [channel]);
  }

  /**
   * Returns the primary chat id for the given channel — the most-recently
   * added numeric allowlist entry. Null when no numeric entry exists.
   *
   * Channel-agnostic: future Discord / Slack reuse the same lookup.
   */
  getPrimaryChatId(channel: string): string | null {
    const numericEntries = this.listAllowlist(channel)
      .filter((e) => e.identityKind === "id");
    const last = numericEntries[numericEntries.length - 1];
    return last?.identity ?? null;
  }

  setAllowlist(channel: string, identities: readonly string[]): void {
    const now = Date.now();
    const txn = this.db.transaction(() => {
      this.db.run("DELETE FROM channel_allowlist WHERE channel = ?", [channel]);
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO channel_allowlist
         (channel, identity, identity_kind, display_name, added_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const raw of identities) {
        const id = raw.trim();
        if (!id) continue;
        const normalized = id.startsWith("@") ? id.slice(1) : id;
        const kind = /^\d+$/.test(normalized) ? "id" : "username";
        // For username-kind entries the identity itself is the @handle —
        // populate display_name so the dashboard doesn't have to fall back
        // to the identity column for display.
        const displayName = kind === "username" ? normalized : null;
        insert.run(channel, normalized, kind, displayName, now);
      }
    });
    txn();
  }
}

function toRequestRow(r: RawRequestRow): PairingRequestRow {
  return {
    channel: r.channel,
    senderId: r.sender_id,
    code: r.code,
    username: r.username,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  };
}

function toAllowlistEntry(r: RawAllowlistRow): AllowlistEntry {
  return {
    channel: r.channel,
    identity: r.identity,
    identityKind: r.identity_kind === "username" ? "username" : "id",
    displayName: r.display_name ?? null,
    addedAt: r.added_at,
  };
}

export { toAllowlistEntry };
