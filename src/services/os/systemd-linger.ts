/**
 * Two-phase systemd linger enablement.
 *
 * Linger allows user services to run after logout — required for
 * ghost.service to survive session close.
 *
 * Flow:
 *   1. Already enabled  → return immediately
 *   2. Try passwordless → works on many distros
 *   3. Fall back to sudo with caller confirmation
 */

import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";

export type LingerResult = {
  enabled: boolean;
  method: "already" | "passwordless" | "sudo";
  warning?: string;
};

/**
 * Check current linger status via `loginctl show-user`.
 * Returns null when loginctl is unavailable or the user cannot be resolved.
 */
export function checkLingerStatus(): { user: string; linger: boolean } | null {
  const user = resolveUser();
  if (!user) {
    return null;
  }

  try {
    const result = spawnSync("loginctl", ["show-user", user, "-p", "Linger"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.error || result.status !== 0) {
      return null;
    }
    const line = (result.stdout ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("Linger="));
    if (!line) {
      return null;
    }
    const value = line.split("=")[1]?.trim().toLowerCase();
    return { user, linger: value === "yes" };
  } catch {
    return null;
  }
}

/**
 * Enable linger using a two-phase strategy:
 *   1. Passwordless `loginctl enable-linger`
 *   2. `sudo loginctl enable-linger` (after caller confirmation)
 */
export async function enableLinger(opts: {
  confirmSudo: () => Promise<boolean>;
}): Promise<LingerResult> {
  const user = resolveUser();
  if (!user) {
    return {
      enabled: false,
      method: "passwordless",
      warning: "Could not determine current user for linger enablement",
    };
  }

  // Phase 0: already enabled?
  const current = checkLingerStatus();
  if (current?.linger) {
    return { enabled: true, method: "already" };
  }

  // Phase 1: try without sudo
  const passwordless = spawnSync("loginctl", ["enable-linger", user], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (!passwordless.error && passwordless.status === 0) {
    return { enabled: true, method: "passwordless" };
  }

  // Phase 2: confirm and try with sudo
  const confirmed = await opts.confirmSudo();
  if (!confirmed) {
    return {
      enabled: false,
      method: "sudo",
      warning: "Linger not enabled — Ghost service may stop when you log out",
    };
  }

  const withSudo = spawnSync("sudo", ["loginctl", "enable-linger", user], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (!withSudo.error && withSudo.status === 0) {
    return { enabled: true, method: "sudo" };
  }

  const stderr = (withSudo.stderr ?? "").trim();
  return {
    enabled: false,
    method: "sudo",
    warning: `Failed to enable linger via sudo${stderr ? `: ${stderr}` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveUser(): string | null {
  const fromEnv = process.env.USER?.trim() || process.env.LOGNAME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}
