import { describe, test, expect, mock } from "bun:test";
import pino from "pino";
import { runUpdate, type ServiceRestartOutcome } from "../../src/update/run.js";
import type { VersionCheck } from "../../src/update/version-check.js";

const logger = pino({ level: "silent" });

function fakeVersionCheck(latest: string | null): VersionCheck {
  return {
    getLatest: async () => latest,
  };
}

function channelAwareVersionCheck(byTag: Record<string, string | null>): VersionCheck & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getLatest: async (_force?: boolean, tag = "latest") => {
      calls.push(tag);
      return byTag[tag] ?? null;
    },
  };
}

const noRestart = async (): Promise<ServiceRestartOutcome> => ({ kind: "not-installed" });

describe("runUpdate", () => {
  test("prints error and exits 1 when registry unreachable", async () => {
    const lines: string[] = [];
    const errLines: string[] = [];
    const spawn = mock(async () => 0);
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck(null),
      spawnUpdate: spawn,
      readCurrentVersion: () => "0.0.1",
      log: (l) => lines.push(l),
      errLog: (l) => errLines.push(l),
    });
    expect(result.exitCode).toBe(1);
    expect(errLines.some((l) => l.includes("Could not reach update server"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("prints 'already on latest' when no newer version exists", async () => {
    const lines: string[] = [];
    const spawn = mock(async () => 0);
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.1"),
      spawnUpdate: spawn,
      readCurrentVersion: () => "0.0.1",
      log: (l) => lines.push(l),
      errLog: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Already on latest"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("runs bun install with correct args when update is available", async () => {
    const lines: string[] = [];
    const spawn = mock(async (args: { packageSpec: string; registry: string }) => {
      expect(args.packageSpec).toBe("@hyperflow.fun/ghost@0.0.2");
      expect(args.registry).toContain("registry.npmjs.org");
      return 0;
    });
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.2"),
      spawnUpdate: spawn,
      readCurrentVersion: () => "0.0.1",
      restartService: noRestart,
      log: (l) => lines.push(l),
      errLog: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Updating v0.0.1 → v0.0.2"))).toBe(true);
    expect(lines.some((l) => l.includes("Updated to v0.0.2"))).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("surfaces non-zero bun exit code", async () => {
    const errLines: string[] = [];
    const spawn = mock(async () => 42);
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.2"),
      spawnUpdate: spawn,
      readCurrentVersion: () => "0.0.1",
      restartService: noRestart,
      log: () => {},
      errLog: (l) => errLines.push(l),
    });
    expect(result.exitCode).toBe(42);
    expect(errLines.some((l) => l.includes("Update failed"))).toBe(true);
  });

  test("restarts the service when it's running", async () => {
    const lines: string[] = [];
    const restart = mock(async (): Promise<ServiceRestartOutcome> => ({ kind: "restarted" }));
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.2"),
      spawnUpdate: async () => 0,
      readCurrentVersion: () => "0.0.1",
      restartService: restart,
      log: (l) => lines.push(l),
      errLog: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes("Daemon restarted"))).toBe(true);
  });

  test("prints manual-restart hint when no service registered", async () => {
    const lines: string[] = [];
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.2"),
      spawnUpdate: async () => 0,
      readCurrentVersion: () => "0.0.1",
      restartService: noRestart,
      log: (l) => lines.push(l),
      errLog: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.includes("No background service registered"))).toBe(true);
  });

  test("surfaces restart failure without failing the overall update", async () => {
    const errLines: string[] = [];
    const result = await runUpdate({
      logger,
      versionCheck: fakeVersionCheck("0.0.2"),
      spawnUpdate: async () => 0,
      readCurrentVersion: () => "0.0.1",
      restartService: async () => ({ kind: "failed", reason: "systemctl unavailable" }),
      log: () => {},
      errLog: (l) => errLines.push(l),
    });
    expect(result.exitCode).toBe(0);
    expect(errLines.some((l) => l.includes("service restart failed"))).toBe(true);
    expect(errLines.some((l) => l.includes("systemctl unavailable"))).toBe(true);
  });

  test("honors GHOST_REGISTRY env override", async () => {
    const prev = process.env["GHOST_REGISTRY"];
    process.env["GHOST_REGISTRY"] = "https://my-mirror.test/api/v4/projects/1/packages/npm/";
    try {
      const spawn = mock(async (args: { packageSpec: string; registry: string }) => {
        expect(args.registry).toBe("https://my-mirror.test/api/v4/projects/1/packages/npm/");
        return 0;
      });
      const result = await runUpdate({
        logger,
        versionCheck: fakeVersionCheck("0.0.2"),
        spawnUpdate: spawn,
        readCurrentVersion: () => "0.0.1",
        log: () => {},
        errLog: () => {},
      });
      expect(result.exitCode).toBe(0);
    } finally {
      if (prev === undefined) delete process.env["GHOST_REGISTRY"];
      else process.env["GHOST_REGISTRY"] = prev;
    }
  });

  test("--channel=rc resolves the rc dist-tag instead of latest", async () => {
    const check = channelAwareVersionCheck({ latest: "0.0.3", rc: "0.0.4-rc.2" });
    const lines: string[] = [];
    const spawn = mock(async (args: { packageSpec: string }) => {
      expect(args.packageSpec).toBe("@hyperflow.fun/ghost@0.0.4-rc.2");
      return 0;
    });
    const result = await runUpdate({
      logger,
      versionCheck: check,
      spawnUpdate: spawn,
      readCurrentVersion: () => "0.0.3",
      restartService: noRestart,
      channel: "rc",
      log: (l) => lines.push(l),
      errLog: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(check.calls).toEqual(["rc"]);
    expect(lines.some((l) => l.includes("channel: rc"))).toBe(true);
  });

  test("unknown channel fails with a channel-specific error", async () => {
    const check = channelAwareVersionCheck({ latest: "0.0.3" });
    const errLines: string[] = [];
    const result = await runUpdate({
      logger,
      versionCheck: check,
      spawnUpdate: mock(async () => 0),
      readCurrentVersion: () => "0.0.3",
      channel: "banana",
      log: () => {},
      errLog: (l) => errLines.push(l),
    });
    expect(result.exitCode).toBe(1);
    expect(errLines.some((l) => l.includes("channel 'banana'"))).toBe(true);
  });
});

