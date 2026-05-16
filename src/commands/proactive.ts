/**
 * `ghost proactive on|off|status` — CLI kill-switch for the unified observer
 * loop. Alerts and proactive chat both flow through this single flag because
 * the observer is the sole proactive/alert scanner.
 */

import type { Config } from "../config/schema.js";
import type { Logger } from "pino";

export type ProactiveAction = "on" | "off" | "status";

export interface ProactiveCommandDeps {
  config: Config;
  writeConfig: (cfg: Config) => Promise<void> | void;
  logger: Logger;
}

export interface ProactiveStatus {
  enabled: boolean;
  timezone: string;
}

export async function runProactiveCommand(
  action: ProactiveAction,
  deps: ProactiveCommandDeps,
): Promise<ProactiveStatus> {
  const { config, writeConfig, logger } = deps;

  if (action === "on" || action === "off") {
    config.observer.enabled = action === "on";
    await writeConfig(config);
    logger.info({ enabled: config.observer.enabled }, `observer ${action}`);
  }

  return {
    enabled: config.observer.enabled,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
