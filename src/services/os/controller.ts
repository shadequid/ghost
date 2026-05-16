/**
 * Per-OS daemon-as-service registration.
 * Unified interface; concrete implementations per platform.
 */

import type { Logger } from "pino";

export interface InstallOptions {
  /** Absolute path to the `ghost` executable / script (resolved by caller). */
  execPath: string;
  /** Absolute path to the `bun` runtime binary. Used as the interpreter so
   *  service definitions don't depend on PATH or shebang resolution. */
  bunPath: string;
  /** Optional env vars to inject into the service definition. */
  env?: Record<string, string>;
  /** Absolute path to log directory (created by caller). */
  logDir: string;
}

export interface InstallResult {
  /** True if install succeeded and the service is registered. */
  ok: boolean;
  /** Absolute path to the service definition file (plist/unit/cmd). */
  definitionPath: string;
  /** Optional warnings to print to the user. */
  warnings?: string[];
}

export interface UninstallOptions {
  /** If true, also remove log files. Default: false. */
  purgeLogs?: boolean;
}

export interface UninstallResult {
  ok: boolean;
  warnings?: string[];
}

export type ServiceStatus = "running" | "stopped" | "not-installed";

export interface ServiceController {
  install(opts: InstallOptions): Promise<InstallResult>;
  uninstall(opts: UninstallOptions): Promise<UninstallResult>;
  /** Stop the running service without removing its registration. */
  stop(): Promise<void>;
  /** Restart the running service in-place (preserves registration). */
  restart(): Promise<void>;
  status(): Promise<ServiceStatus>;
}

/**
 * Dispatch by `process.platform`.
 *
 * Uses synchronous `require()` intentionally — the public API is sync so callers
 * can resolve the controller without awaiting. Bun supports `require()` in ESM.
 * The `as typeof import(...)` casts restore full type inference that `require()`
 * loses natively.
 */
export function resolveServiceController(log: Logger, platform?: NodeJS.Platform): ServiceController {
  const p = platform ?? process.platform;
  switch (p) {
    case "darwin": {
      const { LaunchdController } = require("./launchd.js") as typeof import("./launchd.js");
      return new LaunchdController(log);
    }
    case "linux": {
      const { SystemdController } = require("./systemd.js") as typeof import("./systemd.js");
      return new SystemdController(log);
    }
    case "win32": {
      const { SchtasksController } = require("./schtasks.js") as typeof import("./schtasks.js");
      return new SchtasksController(log);
    }
    default:
      throw new Error(`Unsupported platform: ${p}`);
  }
}
