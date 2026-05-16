/**
 * `ghost --version` / `ghost version` handler.
 *
 * Behavior:
 *   - Reads installed version from package.json (`getCurrentVersion()`).
 *   - Probes the npm registry's `dist-tags.latest` with a 2s timeout.
 *   - On fetch success and `latest > current`, prints the hint line.
 *   - On fetch failure (timeout, non-200, malformed body), prints current only.
 *   - Always exits the caller normally; this function never throws.
 *
 * Caller passes a logger; pass `pino({ level: "silent" })` to suppress
 * fetch-failure warnings.
 *
 * No cache reads or writes. The daemon's `VersionCheckService` still owns
 * the on-disk cache that backs `ghost status`; this code path is independent.
 */
import type { Logger } from "pino";
import { fetchLatestVersion } from "../update/version-check.js";
import { formatHintLine, getCurrentVersion } from "../update/version.js";

// 2s — short enough that --version still feels instant on a healthy network,
// long enough to ride out a slow DNS lookup.
const CLI_FETCH_TIMEOUT_MS = 2000;

export interface RunVersionOptions {
  /** Emit `{current, latest, updateAvailable}` JSON instead of plain text. */
  json: boolean;
  /** Required. Pass `pino({ level: "silent" })` to suppress fetch-failure warnings. */
  logger: Logger;
}

export async function runVersion(opts: RunVersionOptions): Promise<void> {
  const current = getCurrentVersion();
  const latest = await fetchLatestVersion({
    timeoutMs: CLI_FETCH_TIMEOUT_MS,
    logger: opts.logger,
  });

  const hint = formatHintLine(current, latest);
  const updateAvailable = hint !== null;

  if (opts.json) {
    // Field order matches the pre-existing --version --json shape: current, latest, updateAvailable.
    console.log(JSON.stringify({ current, latest, updateAvailable }));
    return;
  }

  console.log(current);
  if (hint) console.log(hint);
}
