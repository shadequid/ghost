/**
 * Onboard service-registration step.
 *
 * Prompts the user to register Ghost as an OS auto-start service, then probes
 * the gateway for reachability. Fully injectable for testability.
 */

import type { ServiceController } from "../../services/os/controller.js";

export interface ServiceStepDeps {
  controller: ServiceController;
  /** Confirm prompt — return true to install. */
  prompt: (message: string) => Promise<boolean>;
  /** Already-installed 3-way menu. */
  alreadyInstalledChoice: (message: string) => Promise<"keep" | "restart" | "reinstall" | "uninstall">;
  /**
   * Pre-decided action for the already-installed branch. When set, skips
   * `alreadyInstalledChoice` entirely and runs that scenario directly.
   * Used by the re-onboard path to always restart on a config change.
   */
  forceChoice?: "keep" | "restart" | "reinstall" | "uninstall";
  /** For Linux only: confirm sudo-linger prompt. */
  confirmLinger: (message: string) => Promise<boolean>;
  /** Returns true if the gateway became reachable within deadline. */
  waitReachable: () => Promise<boolean>;
  /** process.platform injection for testability. */
  platform: NodeJS.Platform;
  /** Resolved install options. */
  installOpts: { execPath: string; bunPath: string; logDir: string; env: Record<string, string> };
}

export type ServiceStepAction =
  | "installed"
  | "reinstalled"
  | "restarted"
  | "uninstalled"
  | "kept"
  | "skipped";

export interface ServiceStepResult {
  action: ServiceStepAction;
  warnings: string[];
}

export async function runServiceStep(deps: ServiceStepDeps): Promise<ServiceStepResult> {
  const warnings: string[] = [];
  const currentStatus = await deps.controller.status();

  if (currentStatus !== "not-installed") {
    const choice = deps.forceChoice ?? await deps.alreadyInstalledChoice("Ghost service already installed");

    if (choice === "keep") return { action: "kept", warnings };

    if (choice === "uninstall") {
      await deps.controller.uninstall({});
      return { action: "uninstalled", warnings };
    }

    if (choice === "restart") {
      // Uninstall + reinstall is the safest restart (picks up new exec path).
      await deps.controller.uninstall({});
      const result = await deps.controller.install(deps.installOpts);
      warnings.push(...(result.warnings ?? []));
      await probeReachability(deps, warnings);
      return { action: "restarted", warnings };
    }

    // "reinstall" — full uninstall + install.
    await deps.controller.uninstall({});
  } else {
    // Fresh install — prompt user.
    const yes = await deps.prompt("Install Ghost service (recommended)");
    if (!yes) return { action: "skipped", warnings };
  }

  // Linger prompt for Linux (before install, so user understands implications).
  if (deps.platform === "linux") {
    try {
      const { enableLinger } = await import("../../services/os/systemd-linger.js");
      const lingerResult = await enableLinger({ confirmSudo: () => deps.confirmLinger(
        "Enable lingering? Without it, Ghost stops when you log out. (may require sudo)",
      ) });
      if (!lingerResult.enabled && lingerResult.warning) {
        warnings.push(lingerResult.warning);
      }
    } catch {
      // Linger is best-effort; service still works while user is logged in.
    }
  }

  const installResult = await deps.controller.install(deps.installOpts);
  warnings.push(...(installResult.warnings ?? []));

  // Post-install reachability probe.
  await probeReachability(deps, warnings);

  return {
    action: currentStatus === "not-installed" ? "installed" : "reinstalled",
    warnings,
  };
}

async function probeReachability(deps: ServiceStepDeps, warnings: string[]): Promise<void> {
  const reachable = await deps.waitReachable();
  if (!reachable) {
    warnings.push("Gateway did not become reachable within 15s — check logs for details");
  }
}
