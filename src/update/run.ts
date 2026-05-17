/**
 * `ghost update` command — fetches the latest published version from
 * the Package Registry, compares to the currently installed version,
 * shells out to `bun install -g @hyperflow.fun/ghost@<latest>`, and
 * restarts the registered background service (systemd/launchd/schtasks)
 * so the daemon picks up the new binary. User data under `~/.ghost/`
 * is never touched.
 */

import type { Logger } from "pino";
import { PACKAGE_NAME, getRegistryUrl } from "./registry.js";
import { semverGt } from "./semver.js";
import { VersionCheckService, type VersionCheck } from "./version-check.js";
import { getCurrentVersion } from "./version.js";

export type ServiceRestartOutcome =
  | { kind: "restarted" }
  | { kind: "not-installed" }
  | { kind: "stopped" }
  | { kind: "failed"; reason: string };

export interface UpdateCommandDeps {
  logger: Logger;
  versionCheck?: VersionCheck;
  /**
   * npm dist-tag to track. Defaults to "latest" (production). Dev testers
   * pass "rc" to track pre-release builds; "test" is for CI smoke tests.
   */
  channel?: string;
  /** Spawns `bun install -g` and resolves to exit code. */
  spawnUpdate?: (args: SpawnUpdateArgs) => Promise<number>;
  readCurrentVersion?: () => string;
  /**
   * Restart the OS-registered daemon service so it runs the new binary.
   * Default resolves the platform service controller; tests inject a stub.
   */
  restartService?: () => Promise<ServiceRestartOutcome>;
  log?: (line: string) => void;
  errLog?: (line: string) => void;
}

export interface SpawnUpdateArgs {
  packageSpec: string;
  registry: string;
}

export interface UpdateCommandResult {
  exitCode: number;
}

/** Run the update flow. Returns the exit code the caller should propagate. */
export async function runUpdate(
  deps: UpdateCommandDeps,
): Promise<UpdateCommandResult> {
  const log = deps.log ?? ((line) => console.log(line));
  const errLog = deps.errLog ?? ((line) => console.error(line));
  const readCurrent = deps.readCurrentVersion ?? getCurrentVersion;
  const registryUrl = getRegistryUrl();
  const check = deps.versionCheck ?? new VersionCheckService({ logger: deps.logger });
  const spawn = deps.spawnUpdate ?? defaultSpawnUpdate;
  const channel = deps.channel ?? "latest";

  const current = readCurrent();

  const latest = await check.getLatest(true, channel);
  if (latest === null) {
    errLog(
      channel === "latest"
        ? "Could not reach update server. Try again later."
        : `Could not find channel '${channel}' in the registry.`,
    );
    return { exitCode: 1 };
  }

  if (!semverGt(latest, current)) {
    log(`Already on latest (v${current}) for channel '${channel}'.`);
    return { exitCode: 0 };
  }

  log(`Updating v${current} → v${latest} (channel: ${channel})…`);
  const code = await spawn({
    packageSpec: `${PACKAGE_NAME}@${latest}`,
    registry: registryUrl,
  });

  if (code !== 0) {
    errLog(`Update failed (exit code ${code}). Previous version remains installed.`);
    return { exitCode: code };
  }

  log(`Updated to v${latest}.`);

  const restartFn = deps.restartService ?? (() => defaultRestartService(deps.logger));
  const outcome = await restartFn();
  switch (outcome.kind) {
    case "restarted":
      log("Daemon restarted — running the new version.");
      break;
    case "stopped":
      log("Service is registered but stopped — start it with `ghost daemon` or the OS service manager.");
      break;
    case "not-installed":
      log("No background service registered. Restart any running `ghost daemon` manually to apply.");
      break;
    case "failed":
      errLog(`Update installed but service restart failed: ${outcome.reason}`);
      errLog("Restart the daemon manually with your OS service manager.");
      break;
  }
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

async function defaultRestartService(logger: Logger): Promise<ServiceRestartOutcome> {
  // Import lazily: platforms other than darwin/linux/win32 throw when
  // `resolveServiceController` is called, and we don't want a plain
  // `bun update` to blow up on e.g. FreeBSD.
  try {
    const { resolveServiceController } = await import("../services/os/controller.js");
    const controller = resolveServiceController(logger.child({ module: "service" }));
    const status = await controller.status();
    if (status === "not-installed") return { kind: "not-installed" };
    if (status === "stopped") return { kind: "stopped" };
    await controller.restart();
    return { kind: "restarted" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason };
  }
}

async function defaultSpawnUpdate(args: SpawnUpdateArgs): Promise<number> {
  // `--no-cache` ignores bun's manifest cache so the newly-published
  // version isn't shadowed by a stale snapshot from a prior probe. Plain
  // `--force` doesn't refresh the manifest cache, so an exact-version
  // install like `@0.0.2-rc.14` fails with "No version matching" even
  // though the registry has it.
  const proc = Bun.spawn(
    ["bun", "install", "-g", args.packageSpec, `--registry=${args.registry}`, "--no-cache"],
    {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    },
  );
  return await proc.exited;
}
