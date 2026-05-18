/**
 * Systemd user unit template builder.
 * Produces a .service file string for `~/.config/systemd/user/`.
 */

export interface UnitOptions {
  description: string;
  execStart: string;
  workingDir: string;
  /**
   * Absolute path to the log file. Daemon stdout+stderr are redirected here
   * via `StandardOutput=append:` / `StandardError=append:` so `ghost logs`
   * can tail it the same way it does on macOS (launchd) and Windows
   * (schtasks). Without this, stdout would go to journald and the file
   * `ghost logs` polls would never appear.
   */
  logFile: string;
  env: Record<string, string>;
}

const SYSTEMD_LINE_BREAKS = /[\r\n]/;

function assertNoLineBreaks(value: string, label: string): void {
  if (SYSTEMD_LINE_BREAKS.test(value)) {
    throw new Error(`${label} must not contain CR or LF characters`);
  }
}

function renderEnvLines(env: Record<string, string>): string[] {
  const entries = Object.entries(env).filter(
    ([, value]) => typeof value === "string" && value.trim(),
  );
  if (entries.length === 0) {
    return [];
  }
  return entries.map(([key, value]) => {
    assertNoLineBreaks(key, "Environment variable name");
    assertNoLineBreaks(value, "Environment variable value");
    return `Environment="${key}=${value.trim()}"`;
  });
}

/** Build a complete systemd user unit file string. */
export function buildUnit(opts: UnitOptions): string {
  assertNoLineBreaks(opts.description, "Unit description");
  assertNoLineBreaks(opts.execStart, "ExecStart");
  assertNoLineBreaks(opts.workingDir, "WorkingDirectory");
  assertNoLineBreaks(opts.logFile, "Log file path");

  const envLines = renderEnvLines(opts.env);

  return [
    "[Unit]",
    `Description=${opts.description}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    `ExecStart=${opts.execStart}`,
    "Restart=always",
    "RestartSec=5",
    "TimeoutStopSec=30",
    "TimeoutStartSec=30",
    "SuccessExitStatus=0 143",
    "KillMode=control-group",
    `WorkingDirectory=${opts.workingDir}`,
    `StandardOutput=append:${opts.logFile}`,
    `StandardError=append:${opts.logFile}`,
    ...envLines,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
