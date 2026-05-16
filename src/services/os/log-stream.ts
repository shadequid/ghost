/**
 * Shared service log streaming utility.
 *
 * Streams ~/.ghost/logs/ghost.log to stdout using platform-appropriate
 * commands. Pino writes synchronously to the file from every daemon path
 * (foreground + service), so a single tail covers every install topology.
 *
 *   - Linux / macOS: tail -f ~/.ghost/logs/ghost.log
 *   - Windows: PowerShell Get-Content -Wait
 *
 * Blocks until the user presses Ctrl+C or the child process exits.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultLogDir } from "./utils.js";

/**
 * Ensure the log file exists before streaming so `tail -f` /
 * `Get-Content -Wait` don't error when the daemon has not yet written.
 */
function ensureLogFile(logPath: string): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(logPath)) writeFileSync(logPath, "", "utf8");
}

export async function streamServiceLogs(): Promise<void> {
  let child: import("node:child_process").ChildProcess;

  const logPath = join(defaultLogDir(), "ghost.log");
  ensureLogFile(logPath);

  if (process.platform === "win32") {
    // Escape single quotes for PowerShell single-quoted strings (' → '')
    const safePath = logPath.replace(/'/g, "''");
    // Use full path — Bun may not resolve "powershell" from PATH on some Windows setups.
    const ps = join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    // Pino writes UTF-8 (box-drawing chars in the startup banner, em dashes,
    // etc.). Windows PowerShell 5.1's Get-Content defaults to ANSI/cp1252 on
    // no-BOM files, so the read stage mangles UTF-8 first. Setting
    // [Console]::OutputEncoding to UTF-8 swaps PowerShell's .NET console
    // writer to a UTF-8 encoder — combined with -Encoding UTF8 on the read,
    // glyphs render correctly via WriteConsoleW even when the inherited
    // conhost code page is still OEM.
    const command = [
      "$OutputEncoding = [System.Text.Encoding]::UTF8",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      `Get-Content -Path '${safePath}' -Tail 30 -Wait -Encoding UTF8`,
    ].join("; ");
    child = spawn(ps, ["-NoProfile", "-Command", command], { stdio: "inherit" });
  } else {
    // Linux, macOS, and other POSIX platforms.
    child = spawn("tail", ["-f", logPath], { stdio: "inherit" });
  }

  // Block until the child exits (user presses Ctrl+C).
  // Remove signal listeners after child exits to prevent leaks.
  // Guard against calling resolve() twice (signal + exit race).
  await new Promise<void>((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      child.kill("SIGTERM");
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
      resolve();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    child.on("exit", () => {
      if (resolved) return;
      resolved = true;
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
      resolve();
    });
  });
}
