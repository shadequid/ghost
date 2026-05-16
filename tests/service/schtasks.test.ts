import { describe, test, expect } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildLauncherCmd,
  SchtasksController,
} from "../../src/services/os/schtasks.js";

describe("buildLauncherCmd", () => {
  test("contains @echo off header", () => {
    const cmd = buildLauncherCmd("C:\\Users\\trader\\.bun\\bin\\bun.exe", "C:\\Users\\trader\\.bun\\bin\\ghost.exe");
    expect(cmd).toContain("@echo off");
  });

  test("contains cd /d into .ghost directory", () => {
    const cmd = buildLauncherCmd("C:\\Users\\trader\\.bun\\bin\\bun.exe", "C:\\Users\\trader\\.bun\\bin\\ghost.exe");
    expect(cmd).toContain("cd /d");
    expect(cmd).toContain(".ghost");
  });

  test("invokes ghost.exe directly without bun prefix", () => {
    const bunPath = "C:\\Users\\trader\\.bun\\bin\\bun.exe";
    const execPath = "C:\\Users\\trader\\.bun\\bin\\ghost.exe";
    const cmd = buildLauncherCmd(bunPath, execPath);
    // Windows .exe shims embed the runtime — running `bun ghost.exe` parses the
    // PE header as JavaScript and crashes with "Expected ';'".
    expect(cmd).toContain(`"${execPath}" daemon`);
    expect(cmd).not.toContain(bunPath);
  });

  test("redirects stdout and stderr to a single ghost.log file", () => {
    // Detached spawn with stdio:ignore gives the child null handles — the
    // daemon dies on first log write. Redirection inside the .cmd opens
    // real file handles before ghost.exe runs.
    // stdout → ghost.log; stderr merged via 2>&1 (order is critical).
    const cmd = buildLauncherCmd("bun.exe", "C:\\ghost.exe");
    expect(cmd).toContain("1>>");
    expect(cmd).toContain("2>&1");
    expect(cmd).toContain("ghost.log");
    expect(cmd).not.toContain("daemon.stdout.log");
    expect(cmd).not.toContain("daemon.stderr.log");
    // No separate stderr redirect
    expect(cmd).not.toContain("2>>");
  });

  test("uses CRLF line endings", () => {
    const cmd = buildLauncherCmd("C:\\bun.exe", "C:\\ghost.exe");
    // Split by \r\n — all lines should be separated this way.
    const lines = cmd.split("\r\n");
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  test("contains rem comment with description", () => {
    const cmd = buildLauncherCmd("bun.exe", "ghost.exe");
    expect(cmd).toContain("rem Ghost daemon launcher");
  });

  test("excludes PATH from env set lines", () => {
    const cmd = buildLauncherCmd("bun.exe", "ghost.exe", {
      PATH: "C:\\Windows\\system32;C:\\Windows",
      GHOST_LOG_DIR: "C:\\Users\\test\\.ghost\\logs",
    });
    expect(cmd).not.toContain("set \"PATH=");
    expect(cmd).toContain('set "GHOST_LOG_DIR=C:\\Users\\test\\.ghost\\logs"');
  });

  test("single-shot launcher: env passthrough, merged log redirect, no supervisor loop", () => {
    const cmd = buildLauncherCmd(
      "C:\\ignored\\bun.exe",
      "C:\\Users\\test\\.bun\\bin\\ghost.exe",
      { FOO: "bar" },
    );

    // No supervisor loop constructs — cmd.exe exits after ghost.exe returns.
    expect(cmd).not.toContain(":loop");
    expect(cmd).not.toContain("goto loop");
    expect(cmd).not.toContain("timeout /t 5");
    expect(cmd).not.toContain("EXITCODE");
    expect(cmd).not.toContain("[supervisor]");

    // GHOST_LOG set line before the invocation.
    expect(cmd).toContain(`set "GHOST_LOG=${join(homedir(), ".ghost", "logs", "ghost.log")}"`);

    // Daemon invocation with merged single-stream redirect via GHOST_LOG variable.
    expect(cmd).toContain('"C:\\Users\\test\\.bun\\bin\\ghost.exe" daemon 1>>"%GHOST_LOG%" 2>&1');

    // Env passthrough.
    expect(cmd).toContain('set "FOO=bar"');

    // No legacy separate-stream redirects.
    expect(cmd).not.toContain("daemon.stdout.log");
    expect(cmd).not.toContain("daemon.stderr.log");
    expect(cmd).not.toContain("2>>");
  });
});

const isWin = process.platform === "win32";

const describeWin = isWin ? describe : describe.skip;

describeWin("SchtasksController (Windows integration)", () => {
  const controller = new SchtasksController();

  test("install creates task and returns ok", async () => {
    const result = await controller.install({
      execPath: "C:\\Users\\test\\.bun\\bin\\ghost.exe",
      bunPath: "C:\\Users\\test\\.bun\\bin\\bun.exe",
      logDir: "C:\\Users\\test\\.ghost\\logs",
    });
    expect(result.ok).toBe(true);
    expect(result.definitionPath).toBeTruthy();
  });

  test("status returns a valid state", async () => {
    const status = await controller.status();
    expect(["running", "stopped", "not-installed"]).toContain(status);
  });

  test("uninstall cleans up and returns ok", async () => {
    const result = await controller.uninstall({ purgeLogs: false });
    expect(result.ok).toBe(true);
  });
});
