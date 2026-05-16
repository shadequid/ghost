/**
 * SQLite migration runner. Reads `PRAGMA user_version`, applies any
 * pending migrations in ascending version order, and bumps
 * `user_version` after each successful step.
 *
 * Failures are rethrown with a wrapped message identifying which step
 * failed. The bad step's `PRAGMA user_version` is NOT advanced, so
 * re-running the runner on the same DB will retry the same step.
 */

import type { Database } from "bun:sqlite";
import {
  assertUniqueVersions,
  assertValidVersions,
  type Migration,
} from "./registry.js";

/**
 * Apply all pending database migrations in order.
 *
 * @param db - the bun:sqlite Database to migrate
 * @param migrations - the list of migrations that ship with this build.
 *   Duplicated version numbers are rejected. Order in the argument does
 *   not matter — the runner sorts by `version`.
 * @throws when any migration step throws. The wrapped error includes
 *   the from/to versions and the original error message.
 */
export async function runDbMigrations(
  db: Database,
  migrations: ReadonlyArray<Migration<Database>>,
): Promise<void> {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  assertUniqueVersions(sorted);
  // Pre-check: reject malformed versions before any up() runs so a bad
  // registry cannot leave the DB in a half-migrated state. PRAGMA does
  // not support prepared-statement parameters for pragma values, but
  // versions come from our own registry (not user input) and we validate
  // here that each is a positive integer, so templating the integer
  // below is safe.
  assertValidVersions(sorted);

  let appliedVersion = readUserVersion(db);

  for (const m of sorted) {
    if (m.version <= appliedVersion) continue;

    try {
      await m.up(db);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[migration db v${appliedVersion}→v${m.version} ${m.label}] ${reason}`,
      );
    }
    db.run(`PRAGMA user_version = ${m.version}`);
    appliedVersion = m.version;
  }
}

function readUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as
    | { user_version: number }
    | null;
  return Number(row?.user_version ?? 0);
}
