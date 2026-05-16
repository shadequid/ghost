/**
 * Persistent cache for the last-seen registry version check result.
 *
 * The daemon's in-memory `VersionCheckService` is the authoritative
 * probe, but the CLI `ghost status` handler has no running service to
 * query — and it must never perform a blocking network fetch itself.
 * Persisting the last fetch result to `~/.ghost/update-cache.json` lets
 * the CLI surface the update hint accurately and survives restarts.
 *
 * Contract:
 *   - `readUpdateCache()`  — returns the last-written snapshot, or null
 *                            on missing/malformed/unreadable files.
 *                            EACCES/ENOSPC logged at warn when a logger
 *                            is supplied; otherwise silent.
 *   - `writeUpdateCache()` — atomic write (tmp → rename). Never throws;
 *                            logged at warn when a logger is supplied.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { getGhostDir } from "../config/paths.js";

/** Shape persisted to `~/.ghost/update-cache.json`. */
export interface UpdateCache {
  /** Latest version string from the registry, or null if the last fetch failed. */
  latestVersion: string | null;
  /** Unix ms timestamp of the last fetch (success or failure). */
  checkedAt: number;
}

/** Absolute path to the update cache file. */
export function getUpdateCachePath(): string {
  return join(getGhostDir(), "update-cache.json");
}

/**
 * Read the cache file. Returns null on any failure (missing file,
 * malformed JSON, missing fields, unreadable) — the CLI treats "no
 * cache" identically to "no update available". I/O errors (EACCES,
 * ENOSPC, etc.) are logged at warn when a logger is supplied so a
 * broken cache doesn't silently stick on "no update" forever.
 */
export function readUpdateCache(
  path: string = getUpdateCachePath(),
  logger?: Logger,
): UpdateCache | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    logger?.warn({ err, path }, "version-cache: read failed");
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const checkedAt = obj["checkedAt"];
    if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) return null;
    const latestVersion = obj["latestVersion"];
    if (latestVersion !== null && typeof latestVersion !== "string") return null;
    return { latestVersion, checkedAt };
  } catch {
    // Malformed JSON / fields are expected when the cache file was written
    // by an older build or hand-edited. Silent return — not an I/O error.
    return null;
  }
}

/**
 * Write the cache file atomically: write to a temp sibling, then
 * rename. Swallow all errors — the cache is a best-effort optimization,
 * never fatal. I/O errors surface at warn when a logger is supplied.
 */
export function writeUpdateCache(
  cache: UpdateCache,
  path: string = getUpdateCachePath(),
  logger?: Logger,
): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(cache), { encoding: "utf-8" });
    renameSync(tmp, path);
  } catch (err) {
    logger?.warn({ err, path }, "version-cache: write failed");
    // Best-effort cleanup of the partial tmp file. Ignore failures.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
