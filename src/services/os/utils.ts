import { accessSync, constants, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Check if a file exists and is executable. */
function isExecutable(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Escape the five XML entities (for plist and any XML payload). */
export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Resolve the absolute path to the `ghost` executable installed by bun.
 * Service definitions embed an absolute path — never rely on PATH resolution
 * at service-start time.
 */
export function resolveGhostExecPath(): string {
  const candidates = [
    join(homedir(), ".bun", "bin", process.platform === "win32" ? "ghost.exe" : "ghost"),
    join(homedir(), ".local", "bin", "ghost"),
    "/usr/local/bin/ghost",
  ];
  for (const c of candidates) {
    if (isExecutable(c)) {
      try {
        return realpathSync(c);
      } catch {
        return c;
      }
    }
  }
  // If nothing resolved, return the first candidate — caller decides whether
  // to fail. We don't throw here because unit tests on CI may not have a real install.
  return candidates[0]!;
}

/**
 * Resolve the absolute path to the `bun` runtime binary.
 * Service definitions must use absolute paths — systemd/launchd/schtasks
 * don't inherit the user's login shell PATH, so `#!/usr/bin/env bun` fails.
 */
export function resolveBunPath(): string {
  const candidates = [
    join(homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ];
  for (const c of candidates) {
    if (isExecutable(c)) {
      try {
        return realpathSync(c);
      } catch {
        return c;
      }
    }
  }
  return candidates[0]!;
}

/** Ensure a directory exists; idempotent. */
export function ensureLogDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Default log directory used by all controllers. */
export function defaultLogDir(): string {
  return join(homedir(), ".ghost", "logs");
}
