/**
 * Post-config finalize step for the onboard wizard.
 *
 * Prompts the user to register Ghost as an OS auto-start service,
 * replacing the old blocking startDaemon() call and the detached spawn.
 */

import { existsSync } from "node:fs";
import { confirm, select, log as clackLog } from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import type { Logger } from "pino";
import { resolveServiceController } from "../services/os/controller.js";
import { resolveGhostExecPath, resolveBunPath, defaultLogDir } from "../services/os/utils.js";
import { runLogs } from "../commands/logs/index.js";
import { runServiceStep } from "./steps/service.js";
import { waitForGatewayReachable } from "../health/reachability.js";
import { DEFAULT_GATEWAY_PORT } from "../config/schema.js";

export interface FinalizeOptions {
  interactive: boolean;
  logger: Logger;
  gatewayPort?: number;
}

export async function finalizeOnboard(opts: FinalizeOptions): Promise<void> {
  const port = opts.gatewayPort ?? DEFAULT_GATEWAY_PORT;

  if (!opts.interactive) {
    clackLog.info(
      "Run 'ghost onboard --service' to register the auto-start service, or 'ghost daemon' to start manually.",
    );
    return;
  }

  // Linux preamble — inform user about linger before prompting.
  if (process.platform === "linux") {
    clackLog.info(
      "Linux installs use a systemd user service by default. Without lingering,\n" +
        "systemd stops the user session on logout/idle and kills Ghost.",
    );
  }

  const serviceLog = opts.logger.child({ module: "service" });
  let controller: ReturnType<typeof resolveServiceController>;
  try {
    controller = resolveServiceController(serviceLog);
  } catch (err) {
    clackLog.warn(
      `Service registration not available on this platform: ${err instanceof Error ? err.message : String(err)}`,
    );
    clackLog.info("Run 'ghost daemon' to start Ghost manually.");
    return;
  }

  const execPath = resolveGhostExecPath();
  const bunPath = resolveBunPath();
  if (!existsSync(execPath)) {
    clackLog.warn(
      `Ghost executable not found at ${execPath}. Service may fail to start.`,
    );
  }

  const result = await runServiceStep({
    controller,
    prompt: async (msg) => {
      const r = await confirm({ message: msg, initialValue: true });
      if (isCancel(r)) return false;
      return r === true;
    },
    // Re-onboard always means config just changed — always restart, never
    // show a keep/reinstall/uninstall picker that could silently leave the
    // daemon on the stale config.
    forceChoice: "restart",
    alreadyInstalledChoice: async (msg) => {
      const r = await select({
        message: msg,
        options: [
          { value: "keep" as const, label: "Keep (do nothing)" },
          { value: "restart" as const, label: "Restart" },
          { value: "reinstall" as const, label: "Reinstall" },
          { value: "uninstall" as const, label: "Uninstall" },
        ],
      });
      if (isCancel(r)) return "keep";
      return r as "keep" | "restart" | "reinstall" | "uninstall";
    },
    confirmLinger: async (msg) => {
      const r = await confirm({ message: msg, initialValue: true });
      if (isCancel(r)) return false;
      return r === true;
    },
    waitReachable: () => waitForGatewayReachable({ port, deadlineMs: 15_000 }),
    platform: process.platform,
    installOpts: {
      execPath,
      bunPath,
      logDir: defaultLogDir(),
      env: {
        // Service managers (systemd/launchd/schtasks) don't inherit the user's
        // login shell PATH. Inject it so tools like `claude` CLI are findable.
        PATH: process.env.PATH ?? "",
      },
    },
  });

  for (const w of result.warnings) {
    clackLog.warn(w);
  }

  // Report outcome and take appropriate action.
  switch (result.action) {
    case "installed":
    case "reinstalled":
    case "restarted":
      clackLog.success(`Ghost service ${result.action}. Dashboard: http://127.0.0.1:${port}`);
      clackLog.info("Streaming service logs (Ctrl+C to detach)...\n");
      await runLogs({ follow: true, json: false, plain: false, noColor: false });
      break;
    case "skipped":
      clackLog.info("Starting Ghost daemon in foreground...\n");
      await startForegroundDaemon(opts.logger);
      break;
    case "uninstalled":
      clackLog.info("Ghost service uninstalled. Run 'ghost daemon' to start manually.");
      break;
    case "kept":
      clackLog.info("Service unchanged.");
      break;
  }
}

/**
 * Start the Ghost daemon in the foreground when user skips service registration.
 * Imports and calls startDaemon() so the process stays alive.
 */
async function startForegroundDaemon(logger: Logger): Promise<void> {
  const { startDaemon } = await import("../daemon/index.js");
  await startDaemon({ logger });
}
