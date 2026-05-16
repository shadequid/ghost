/**
 * Package.json version resolution — single source of truth.
 *
 * The shipping layouts this module covers:
 *   - production install: `dist/package.json` sits alongside `dist/index.js`
 *     (resolved via `import.meta.dir`)
 *   - dev via `bun run dev src/<subdir>/…`: two levels up from the subdir
 *   - last-resort fallback: the current working directory
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const UNKNOWN_VERSION = "unknown";

/** Resolve the path to package.json. Returns the first existing candidate, or null. */
export function resolvePackageJsonPath(candidates?: string[]): string | null {
  const list = candidates ?? [
    join(import.meta.dir, "package.json"),
    join(import.meta.dir, "..", "..", "package.json"),
    join(process.cwd(), "package.json"),
  ];
  for (const p of list) {
    if (existsSync(p)) return p;
  }
  return null;
}

import type { UpdateCache } from "./version-cache.js";
import { semverGt } from "./semver.js";

/**
 * Pure hint formatter. Returns `"(update available: vX.Y.Z — run `ghost update`)"`
 * when `latest` is non-null, newer than `current`, and `current` is known.
 * Returns `null` otherwise. No cache or storage coupling — callers that hold
 * an `UpdateCache` should use `formatUpdateHint` instead.
 */
export function formatHintLine(
  current: string,
  latest: string | null,
): string | null {
  if (latest === null) return null;
  if (current === UNKNOWN_VERSION) return null;
  if (!semverGt(latest, current)) return null;
  return `(update available: v${latest} — run \`ghost update\`)`;
}

/**
 * Build the CLI "update available" hint line from a cache snapshot, or
 * return null when no hint should be shown. Thin wrapper over
 * `formatHintLine` for callers that hold an `UpdateCache`.
 */
export function formatUpdateHint(
  current: string,
  cache: UpdateCache | null,
): string | null {
  return formatHintLine(current, cache?.latestVersion ?? null);
}

/** Read the version field from a resolved package.json, or return `UNKNOWN_VERSION`. */
export function getCurrentVersion(pkgPath?: string | null): string {
  const resolved = pkgPath ?? resolvePackageJsonPath();
  if (!resolved) return UNKNOWN_VERSION;
  try {
    const pkg = JSON.parse(readFileSync(resolved, "utf-8")) as { version?: string };
    if (pkg.version && pkg.version.length > 0) return pkg.version;
  } catch {
    /* fall through */
  }
  return UNKNOWN_VERSION;
}
