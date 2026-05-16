/**
 * Thin wrapper around Bun's built-in semver. `Bun.semver.order` implements
 * SemVer 2.0.0 §11 pre-release ordering correctly (rc.10 > rc.9 etc.) and
 * is about 20× faster than node-semver.
 */

/**
 * True if `a` is strictly greater than `b`. Returns false on malformed input,
 * matching the caller contract: a "cannot compare" result must never look
 * like an upgrade is available.
 */
export function semverGt(a: string, b: string): boolean {
  try {
    return Bun.semver.order(a, b) === 1;
  } catch {
    return false;
  }
}
