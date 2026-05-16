import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  ServiceController,
  InstallOptions,
  InstallResult,
  UninstallOptions,
  UninstallResult,
  ServiceStatus,
} from "./controller.js";
import { ensureLogDir, defaultLogDir } from "./utils.js";

const TASK_NAME = "Ghost";

function launcherPath(): string {
  return join(homedir(), ".ghost", "state", "ghost-daemon.cmd");
}

function startupFallbackPath(): string {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "ghost-daemon.cmd",
  );
}

function schtasks(args: readonly string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("schtasks", args, { encoding: "utf8", timeout: 15_000 });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

/**
 * Resolve the current Windows user for `schtasks /RU`. Registering the task
 * under the user's own scope (Task Scheduler Library\<user>) avoids the admin
 * elevation required when schtasks defaults to the machine-wide scope.
 * Returns null when USERNAME is not set.
 */
function resolveTaskUser(): string | null {
  const user = process.env.USERNAME?.trim();
  if (!user) return null;
  const domain = process.env.USERDOMAIN?.trim();
  return domain ? `${domain}\\${user}` : user;
}

/** Characters that can break out of double quotes in Windows batch scripts. */
const BATCH_DANGEROUS = /[%!^&|<>]/;

/**
 * Validate that a path does not contain characters dangerous in .cmd batch files.
 * Throws a clear error if the path is unsafe.
 */
function assertBatchSafePath(label: string, value: string): void {
  if (BATCH_DANGEROUS.test(value)) {
    throw new Error(
      `${label} contains batch-unsafe characters (%, !, ^, &, |, <, >): "${value}". ` +
        "Rename the directory or use a path without special characters.",
    );
  }
}

/** Escape a path for use inside a .cmd script (wrap in double quotes). */
function quoteCmdArg(value: string): string {
  // NTFS forbids " in filenames, but guard against malformed input.
  if (value.includes('"')) {
    throw new Error(`Path contains double quotes which are invalid in .cmd scripts: ${value}`);
  }
  return `"${value}"`;
}

/**
 * Build the batch launcher that schtasks / Startup folder will invoke.
 *
 * `bunPath` is accepted for signature parity with systemd/launchd controllers
 * but unused on Windows: `bun install -g` produces a native `.exe` shim that
 * embeds the bun runtime + JS entry. Running `bun ghost.exe` would parse the
 * PE binary as JavaScript and crash with "Expected ';'" on the MZ header.
 *
 * stdout/stderr are merged into a single ghost.log via `1>>"%GHOST_LOG%" 2>&1`.
 * When the launcher runs under a detached spawn with `stdio: "ignore"`, the
 * daemon inherits null stdio handles and dies the first time it writes (logger
 * banner, pino, etc.). Redirecting at the cmd.exe level opens real file
 * handles before ghost.exe starts, so it has somewhere to write regardless
 * of how the launcher was invoked.
 */
export function buildLauncherCmd(_bunPath: string, execPath: string, env?: Record<string, string>): string {
  assertBatchSafePath("execPath", execPath);

  const ghostDir = join(homedir(), ".ghost");
  const ghostLog = join(ghostDir, "logs", "ghost.log");
  assertBatchSafePath("ghostLog", ghostLog);

  // Skip PATH — it can be thousands of characters and contain %VARS%,
  // which exceeds batch line limits and breaks variable expansion.
  const setLines = Object.entries(env ?? {})
    .filter(([k, v]) => typeof v === "string" && v.trim() && k.toUpperCase() !== "PATH")
    .map(([k, v]) => {
      assertBatchSafePath(`env var ${k}`, v.trim());
      return `set "${k}=${v.trim()}"`;
    });

  return [
    "@echo off",
    "rem Ghost daemon launcher",
    `cd /d "${ghostDir}"`,
    `set "GHOST_LOG=${ghostLog}"`,
    ...setLines,
    `${quoteCmdArg(execPath)} daemon 1>>"%GHOST_LOG%" 2>&1`,
    "",
  ].join("\r\n");
}

/**
 * Build a Startup folder launcher that backgrounds the main daemon script.
 * `start /min` runs the daemon in a minimized (effectively hidden) window on
 * login — the canonical way to detach a long-running process on Windows
 * without leaving a visible console.
 */
function buildStartupLauncher(daemonScriptPath: string): string {
  assertBatchSafePath("daemonScriptPath", daemonScriptPath);
  return [
    "@echo off",
    "rem Ghost -- auto-start launcher (Startup folder)",
    `start /min "" "cmd.exe" /d /s /c ${quoteCmdArg(daemonScriptPath)}`,
    "",
  ].join("\r\n");
}

/**
 * Decide whether a failed schtasks /Create should fall through to the
 * Startup folder. Triggers cover the three legitimate failure modes on
 * locked-down Windows where Task Scheduler registration is unavailable:
 *
 *  - "Access is denied" — standard user without "Log on as batch job" right
 *  - schtasks timed out  — corporate AV / Defender scanning delays the call
 *  - empty stdout/stderr — schtasks.exe missing or killed (Sandbox / PSRP)
 */
function shouldFallbackToStartupEntry(result: { stdout: string; stderr: string; status: number }): boolean {
  const detail = (result.stderr || result.stdout).toLowerCase();
  if (detail.includes("access") && detail.includes("denied")) return true;
  if (detail.includes("timed out")) return true;
  if (detail.trim().length === 0) return true;
  return false;
}

/**
 * Register the Startup folder entry and spawn the daemon. Startup folder
 * triggers only at next logon, so we also launch the daemon now. This is
 * the standard user-session autostart path on Windows — no admin, no UAC,
 * works on every edition regardless of Group Policy.
 */
function installStartupEntry(launcher: string, opts: InstallOptions): string {
  const startup = startupFallbackPath();
  const startupDir = dirname(startup);
  if (!existsSync(startupDir)) {
    mkdirSync(startupDir, { recursive: true });
  }
  writeFileSync(startup, buildStartupLauncher(launcher), { encoding: "utf8" });
  spawnDaemonDirect(opts);
  return startup;
}

/**
 * Attempt schtasks registration. Prefer user-scoped /RU <user> /IT (session
 * token, no admin, no password prompt). If the first attempt fails (older
 * Windows, GPO), retry without /RU.
 */
function createScheduledTask(launcher: string): { stdout: string; stderr: string; status: number } {
  const baseArgs = [
    "/Create",
    "/F",
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/TN",
    TASK_NAME,
    "/TR",
    `"${launcher}"`,
  ];
  const taskUser = resolveTaskUser();
  let create = schtasks(taskUser ? [...baseArgs, "/RU", taskUser, "/IT"] : baseArgs);
  if (create.status !== 0 && taskUser) {
    create = schtasks(baseArgs);
  }
  return create;
}

export class SchtasksController implements ServiceController {
  // Logger accepted for interface parity with launchd/systemd controllers but
  // schtasks uses spawnSync which writes to its own stdout/stderr; no log needed.
  constructor(_log?: unknown) {}

  async install(opts: InstallOptions): Promise<InstallResult> {
    ensureLogDir(opts.logDir);

    const stateDir = join(homedir(), ".ghost", "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    const launcher = launcherPath();
    writeFileSync(launcher, buildLauncherCmd(opts.bunPath, opts.execPath, opts.env), { encoding: "utf8" });

    const create = createScheduledTask(launcher);

    if (create.status === 0) {
      // Start the task immediately so the daemon runs right after install.
      const run = schtasks(["/Run", "/TN", TASK_NAME]);
      if (run.status !== 0) {
        console.warn("[service] schtasks /Run failed — starting daemon directly");
        spawnDaemonDirect(opts);
      }
      return { ok: true, definitionPath: launcher };
    }

    if (shouldFallbackToStartupEntry(create)) {
      const startup = installStartupEntry(launcher, opts);
      return { ok: true, definitionPath: startup };
    }

    return {
      ok: false,
      definitionPath: launcher,
      warnings: [`schtasks create failed: ${create.stderr || create.stdout}`.trim()],
    };
  }

  async stop(): Promise<void> {
    const result = schtasks(["/End", "/TN", TASK_NAME]);
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      // Tolerate "not running" — task is already stopped.
      if (!detail.toLowerCase().includes("not running") && !detail.toLowerCase().includes("not started")) {
        throw new Error(`schtasks /End failed: ${detail}`);
      }
    }
  }

  async restart(): Promise<void> {
    // End the running instance, then re-run it.
    schtasks(["/End", "/TN", TASK_NAME]);
    const result = schtasks(["/Run", "/TN", TASK_NAME]);
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new Error(`schtasks /Run failed: ${detail}`);
    }
  }

  async uninstall(opts: UninstallOptions): Promise<UninstallResult> {
    // End running task (swallow errors).
    schtasks(["/End", "/TN", TASK_NAME]);

    // Delete task registration (swallow errors).
    schtasks(["/Delete", "/F", "/TN", TASK_NAME]);

    // Remove launcher cmd file.
    const launcher = launcherPath();
    if (existsSync(launcher)) {
      unlinkSync(launcher);
    }

    // Remove Startup folder fallback file (if exists).
    const startup = startupFallbackPath();
    if (existsSync(startup)) {
      unlinkSync(startup);
    }

    // Purge logs if requested.
    if (opts.purgeLogs) {
      const logDir = defaultLogDir();
      if (existsSync(logDir)) {
        rmSync(logDir, { recursive: true, force: true });
      }
    }

    return { ok: true };
  }

  async status(): Promise<ServiceStatus> {
    // Use CSV format — machine-readable and locale-independent.
    const query = schtasks(["/Query", "/TN", TASK_NAME, "/V", "/FO", "CSV"]);

    if (query.status !== 0) {
      return "not-installed";
    }

    const output = query.stdout || query.stderr;

    // CSV output has a header row followed by data rows.
    // Find the "Status" column index from the header, then check its value.
    const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length >= 2) {
      const headers = lines[0]!.split('","').map((h) => h.replace(/^"|"$/g, ""));
      const statusIdx = headers.findIndex((h) => h.toLowerCase() === "status");
      if (statusIdx >= 0) {
        const values = lines[1]!.split('","').map((v) => v.replace(/^"|"$/g, ""));
        if (values[statusIdx]?.toLowerCase() === "running") {
          return "running";
        }
        return "stopped";
      }
    }

    // Fallback: try English LIST format for older Windows versions.
    const fallback = schtasks(["/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"]);
    if (fallback.status !== 0) {
      return "not-installed";
    }
    const fallbackOutput = fallback.stdout || fallback.stderr;
    const statusMatch = fallbackOutput.match(/^Status:\s*(.+)$/im);
    if (statusMatch && statusMatch[1]?.trim().toLowerCase() === "running") {
      return "running";
    }

    return "stopped";
  }
}


/**
 * Spawn the daemon as a detached background process by invoking the launcher
 * .cmd we just wrote. Routing through the launcher (instead of rebuilding a
 * command string here) ensures the .exe-direct invocation is actually used —
 * bun would otherwise parse the ghost.exe PE header as JavaScript and crash.
 *
 * cwd/env are intentionally omitted: the launcher already does `cd /d` and
 * sets the env vars it needs. Adding them here shadows the launcher's values
 * and introduces drift between this path and the Startup-folder path.
 */
function spawnDaemonDirect(_opts: InstallOptions): void {
  const launcher = launcherPath();
  // Use Bun.spawn (native) instead of node:child_process.spawn — the Node
  // compat layer on Bun/Windows sets creation flags that cause cmd.exe to
  // exit before running the child command when stdio is ignored, so the
  // launcher never runs and no log files are ever created.
  //
  // ComSpec is the canonical Windows env var for the command interpreter
  // and is always set by the OS; System32\cmd.exe is the universal fallback.
  // The launcher itself handles stdout/stderr redirection to log files.
  const comspec = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const proc = Bun.spawn([comspec, "/d", "/s", "/c", launcher], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
    windowsHide: true,
  });
  proc.unref();
}
