/**
 * Persistent storage for CLI session state.
 *
 * Extends the original handoff state (systemPromptHash + syncedCount) with
 * the SDK sessionId so Claude Agent SDK sessions survive daemon restarts.
 *
 * File format version bumped to 2; version-1 files are silently discarded
 * (sessionId is unknown → next request starts fresh which is safe).
 *
 * Follows the same pattern as CronService (src/scheduler/service.ts).
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";

const CURRENT_VERSION = 2;

// Public shape — used by claude-cli-chat.ts SDK stream adapter
export interface CliSessionState {
  sessionId: string | null;
  systemPromptHash: string;
  syncedCount: number;
}

interface SessionFile {
  version: number;
  sessionId: string | null;
  systemPromptHash: string;
  syncedCount: number;
}

export class CliHandoffStore {
  constructor(private readonly filePath: string, private readonly log: Logger) {}

  /** Load persisted session state. Returns null if missing, corrupt, or wrong version. */
  load(): CliSessionState | null {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: unknown = JSON.parse(raw);
      if (!isValidSessionFile(data)) return null;
      return {
        sessionId: data.sessionId,
        systemPromptHash: data.systemPromptHash,
        syncedCount: data.syncedCount,
      };
    } catch {
      return null;
    }
  }

  /** Persist session state to disk. Logs warning on failure. */
  save(state: CliSessionState): void {
    const data: SessionFile = {
      version: CURRENT_VERSION,
      sessionId: state.sessionId,
      systemPromptHash: state.systemPromptHash,
      syncedCount: state.syncedCount,
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.log.warn({ err }, "failed to save session state");
    }
  }

  /** Delete persisted session state. */
  clear(): void {
    try {
      unlinkSync(this.filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log.warn({ err }, "failed to clear session state");
      }
    }
  }
}

function isValidSessionFile(data: unknown): data is SessionFile {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.version === CURRENT_VERSION &&
    (d.sessionId === null || typeof d.sessionId === "string") &&
    typeof d.systemPromptHash === "string" &&
    Number.isInteger(d.syncedCount) && (d.syncedCount as number) >= 0
  );
}
