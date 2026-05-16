/**
 * Config migration runner. Reads `config.schemaVersion`, applies any
 * pending migrations in order, and returns a new config object. The
 * original input is never mutated.
 *
 * Caller is responsible for persisting the returned config when
 * `dirty === true`.
 */

import type { Config } from "../../config/schema.js";
import { assertUniqueVersions, type Migration } from "./registry.js";

export interface ConfigMigrationResult {
  config: Config;
  dirty: boolean;
}

/**
 * Apply all pending config migrations in order.
 *
 * @param config - the loaded config object. Must carry `schemaVersion`
 *   (defaulted by the Zod schema).
 * @param migrations - the list of migrations that ship with this build.
 * @throws when any migration step throws. The wrapped error identifies
 *   the failing step.
 */
export async function runConfigMigrations(
  config: Config,
  migrations: ReadonlyArray<Migration<Config>>,
): Promise<ConfigMigrationResult> {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  assertUniqueVersions(sorted);

  let current: Config = config;
  let dirty = false;

  for (const m of sorted) {
    if (m.version <= current.schemaVersion) continue;

    const previousVersion = current.schemaVersion;
    // Deep-clone so `up()` can mutate nested objects (e.g. `next.paper.enabled`)
    // without leaking into the caller's original config.
    const next: Config = { ...structuredClone(current), schemaVersion: m.version };

    try {
      await m.up(next);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[migration config v${previousVersion}→v${m.version} ${m.label}] ${reason}`,
      );
    }

    current = next;
    dirty = true;
  }

  return { config: current, dirty };
}
