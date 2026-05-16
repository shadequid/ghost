import { describe, test, expect, afterAll } from "bun:test";
import pino from "pino";
import { SystemdController } from "../../src/services/os/systemd.js";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const noopLog = pino({ level: "silent" });

const isLinux = process.platform === "linux";

/**
 * Check whether systemd user scope is actually usable on this machine.
 * Even on Linux, CI containers often lack a user bus.
 */
function isSystemdUserAvailable(): boolean {
  if (!isLinux) return false;
  const result = spawnSync("systemctl", ["--user", "status"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  // exit 0 = running, exit 3 = "no units loaded" — both mean systemd works
  return !result.error && (result.status === 0 || result.status === 3);
}

const systemdAvailable = isSystemdUserAvailable();

const UNIT_PATH = join(homedir(), ".config", "systemd", "user", "ghost.service");
const UNIT_BAK = `${UNIT_PATH}.bak`;

// Clean up after ourselves on Linux
afterAll(() => {
  if (!isLinux) return;
  // Best-effort cleanup: disable + remove
  spawnSync("systemctl", ["--user", "disable", "--now", "ghost.service"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  for (const f of [UNIT_PATH, UNIT_BAK]) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore
    }
  }
  spawnSync("systemctl", ["--user", "daemon-reload"], {
    encoding: "utf8",
    timeout: 5_000,
  });
});

const describeSystemd = isLinux && systemdAvailable ? describe : describe.skip;

describeSystemd("SystemdController (Linux integration)", () => {
  const ctrl = new SystemdController(noopLog);

  test("status returns not-installed before first install", async () => {
    // Ensure clean state
    spawnSync("systemctl", ["--user", "disable", "--now", "ghost.service"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    try {
      if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH);
    } catch {
      // ignore
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], {
      encoding: "utf8",
      timeout: 5_000,
    });

    const s = await ctrl.status();
    expect(s).toBe("not-installed");
  });

  test("install writes unit file and returns definitionPath", async () => {
    const result = await ctrl.install({
      execPath: "/usr/bin/sleep",
      bunPath: "/usr/bin/env",
      logDir: join(homedir(), ".ghost", "logs"),
      env: { GHOST_TEST: "1" },
    });

    expect(result.ok).toBe(true);
    expect(result.definitionPath).toBe(UNIT_PATH);
    expect(existsSync(UNIT_PATH)).toBe(true);

    const content = readFileSync(UNIT_PATH, "utf8");
    expect(content).toContain("[Unit]");
    expect(content).toContain("ExecStart=/usr/bin/env /usr/bin/sleep daemon");
    expect(content).toContain('Environment="GHOST_TEST=1"');
  }, 15_000);

  test("status returns running or stopped after install", async () => {
    const s = await ctrl.status();
    // The service may fail immediately (sleep daemon is not a real daemon),
    // so we accept either running or stopped — but not not-installed.
    expect(["running", "stopped"]).toContain(s);
  });

  test("install backs up existing unit file", async () => {
    // Stop the service first to avoid systemd restart-loop contention
    spawnSync("systemctl", ["--user", "stop", "ghost.service"], {
      encoding: "utf8",
      timeout: 5_000,
    });

    // Install again over the existing unit
    try {
      await ctrl.install({
        execPath: "/usr/bin/sleep",
        bunPath: "/usr/bin/env",
        logDir: join(homedir(), ".ghost", "logs"),
        env: { GHOST_ROUND: "2" },
      });
    } catch {
      // start may fail if systemd throttles — that's fine for this test
    }

    expect(existsSync(UNIT_BAK)).toBe(true);
    const backup = readFileSync(UNIT_BAK, "utf8");
    // The backup should contain the FIRST install's env, not the second
    expect(backup).toContain("GHOST_TEST");
  }, 15_000);

  test("uninstall removes unit file and returns ok", async () => {
    const result = await ctrl.uninstall({ purgeLogs: false });
    expect(result.ok).toBe(true);
    expect(existsSync(UNIT_PATH)).toBe(false);
    expect(existsSync(UNIT_BAK)).toBe(false);
  });

  test("status returns not-installed after uninstall", async () => {
    const s = await ctrl.status();
    expect(s).toBe("not-installed");
  });
});

describe("SystemdController (always runs)", () => {
  test("implements ServiceController interface", () => {
    const ctrl = new SystemdController(noopLog);
    expect(typeof ctrl.install).toBe("function");
    expect(typeof ctrl.uninstall).toBe("function");
    expect(typeof ctrl.stop).toBe("function");
    expect(typeof ctrl.restart).toBe("function");
    expect(typeof ctrl.status).toBe("function");
  });
});
