// Technique: mock.module registered BEFORE any import of uninstall.ts so that
// SIGKILL_DELAY_MS resolves to 0 in tests — avoids 1s real-timer waits per case.
// process.kill is stubbed per-test via spyOn(process, "kill").
import { describe, test, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import type { ServiceController, ServiceStatus } from "../../src/services/os/controller.js";

// Capture the real module BEFORE the mock replaces it so we can spread it.
const realUninstall = await import("../../src/commands/uninstall.js");

mock.module("../../src/commands/uninstall.ts", () => ({
  ...realUninstall,
  SIGKILL_DELAY_MS: 0,
  WIN_HANDLE_RELEASE_MS: 0,
}));

// Import SUT AFTER mock.module so the registered module is picked up.
const {
  runUninstall,
  stopForegroundGhostDaemons,
  removeBunPackage,
  stripPersistentPath,
  stripNpmrcBlock,
  resolveGatewayPortForUninstall,
} = await import("../../src/commands/uninstall.js");

import type { UninstallDeps, SpawnResult } from "../../src/commands/uninstall.js";

function makeSpawnMock(results: Record<string, SpawnResult>): UninstallDeps["spawn"] {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key in results) return results[key]!;
    for (const pattern of Object.keys(results)) {
      if (key.startsWith(pattern)) return results[pattern]!;
    }
    throw new Error(`unexpected spawn call: ${key}`);
  };
}

function makeDeps(
  overrides: Omit<Partial<UninstallDeps>, "log" | "err" | "exit" | "controller" | "rmSync" | "existsSync" | "readFile" | "writeFile" | "unlink" | "spawn"> & {
    status?: ServiceStatus;
  } = {},
) {
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  const rmCalls: string[] = [];
  const existsReturn = new Map<string, boolean>();
  const counters = { uninstallCalls: 0 };
  let uninstallThrow: Error | null = null;
  let rmThrow: Error | null = null;

  const controller: ServiceController = {
    install: mock(async () => ({ ok: true, definitionPath: "" })),
    uninstall: mock(async () => {
      counters.uninstallCalls++;
      if (uninstallThrow) throw uninstallThrow;
      return { ok: true };
    }),
    stop: mock(async () => {}),
    restart: mock(async () => {}),
    status: mock(async () => overrides.status ?? "running"),
  };

  const deps: UninstallDeps = {
    controller,
    dataDir: "/tmp/fake-ghost",
    home: "/home/test",
    platform: "linux",
    gatewayPort: 15401,
    isTTY: true,
    confirm: async () => true,
    existsSync: (p) => existsReturn.get(p) ?? true,
    readFile: () => "",
    writeFile: () => {},
    unlink: () => {},
    rmSync: (p) => {
      rmCalls.push(p);
      if (rmThrow) throw rmThrow;
    },
    spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    exit: (code) => { exits.push(code); throw new Error(`__EXIT__${code}`); },
    ...overrides,
  };

  return {
    deps, logs, errs, exits, rmCalls,
    get uninstallCalls() { return counters.uninstallCalls; },
    setUninstallThrow: (e: Error) => { uninstallThrow = e; },
    setRmThrow: (e: Error) => { rmThrow = e; },
    setExists: (p: string, v: boolean) => existsReturn.set(p, v),
  };
}

describe("runUninstall", () => {
  test("non-TTY → errors and exits 1, does not call uninstall or rm", async () => {
    const h = makeDeps({ isTTY: false });
    await expect(runUninstall(h.deps)).rejects.toThrow("__EXIT__1");
    expect(h.errs).toEqual(["ghost uninstall requires an interactive terminal."]);
    expect(h.uninstallCalls).toBe(0);
    expect(h.rmCalls).toEqual([]);
  });

  test("TTY + decline → no service uninstall, no rm", async () => {
    const h = makeDeps({ confirm: async () => false });
    await runUninstall(h.deps);
    expect(h.uninstallCalls).toBe(0);
    expect(h.rmCalls).toEqual([]);
  });

  test("TTY + accept + service installed + data exists → uninstall then rm, exit 0", async () => {
    const h = makeDeps({ status: "running" });
    h.setExists("/tmp/fake-ghost", true);
    await runUninstall(h.deps);
    expect(h.uninstallCalls).toBe(1);
    expect(h.rmCalls).toEqual(["/tmp/fake-ghost"]);
    expect(h.exits).toEqual([]);
    // Misleading hand-off hint is gone — bun package removal is automatic now.
    expect(h.logs.some((m) => m.includes("bun remove -g @hyperflow.fun/ghost"))).toBe(false);
    // Completion message must be printed.
    expect(h.logs.some((m) => m.includes("✓ Ghost fully uninstalled") || m.includes("bun is kept"))).toBe(true);
  });

  test("TTY + accept + service not installed → skips uninstall, still rms data", async () => {
    const h = makeDeps({ status: "not-installed" });
    h.setExists("/tmp/fake-ghost", true);
    await runUninstall(h.deps);
    expect(h.uninstallCalls).toBe(0);
    expect(h.rmCalls).toEqual(["/tmp/fake-ghost"]);
    expect(h.exits).toEqual([]);
  });

  test("TTY + accept + data dir missing → skips rm", async () => {
    const h = makeDeps({ status: "not-installed" });
    h.setExists("/tmp/fake-ghost", false);
    await runUninstall(h.deps);
    expect(h.rmCalls).toEqual([]);
    expect(h.exits).toEqual([]);
    // Data dir skipped since it doesn't exist.
    // removeBunPackage still runs (empty stdout → not found → ok:true → anyProgress=true).
    // Misleading hand-off hint is gone.
    expect(h.logs.some((m) => m.includes("bun remove -g @hyperflow.fun/ghost"))).toBe(false);
    // Completion path reached (no failures).
    expect(h.logs.some((m) => m.includes("bun is kept"))).toBe(true);
  });

  test("controller.uninstall throws → still rms data, exits 1", async () => {
    const h = makeDeps({ status: "running" });
    h.setUninstallThrow(new Error("service boom"));
    h.setExists("/tmp/fake-ghost", true);
    await expect(runUninstall(h.deps)).rejects.toThrow("__EXIT__1");
    expect(h.rmCalls).toEqual(["/tmp/fake-ghost"]);
    expect(h.errs.some((m) => m.includes("service boom"))).toBe(true);
  });

  test("rmSync throws → service removal still reported, exits 1", async () => {
    const h = makeDeps({ status: "running" });
    h.setExists("/tmp/fake-ghost", true);
    h.setRmThrow(new Error("rm boom"));
    await expect(runUninstall(h.deps)).rejects.toThrow("__EXIT__1");
    expect(h.uninstallCalls).toBe(1);
    expect(h.logs.some((m) => m.includes("✓ Removed Ghost background service"))).toBe(true);
    expect(h.errs.some((m) => m.includes("rm boom"))).toBe(true);
  });

  test("controller.uninstall returns ok:false with warnings → counts as failure", async () => {
    const h = makeDeps({ status: "running" });
    h.deps.controller.uninstall = mock(async () => ({ ok: false, warnings: ["stuck unit"] }));
    h.setExists("/tmp/fake-ghost", true);
    await expect(runUninstall(h.deps)).rejects.toThrow("__EXIT__1");
    expect(h.errs.some((m) => m.includes("stuck unit"))).toBe(true);
    // Data removal still attempted.
    expect(h.rmCalls).toEqual(["/tmp/fake-ghost"]);
  });

  test("kills foreground daemons BEFORE controller.uninstall (so purgeLogs doesn't EBUSY)", async () => {
    const h = makeDeps({ status: "running" });
    h.setExists("/tmp/fake-ghost", true);
    const callOrder: string[] = [];
    // Capture order: ps/powershell call (from stopForegroundGhostDaemons)
    // must precede controller.uninstall().
    const origSpawn = h.deps.spawn;
    h.deps.spawn = ((cmd, args) => {
      if (cmd === "ps" || cmd === "powershell") callOrder.push("findPids");
      return origSpawn(cmd, args);
    }) as UninstallDeps["spawn"];
    h.deps.controller.uninstall = mock(async () => {
      callOrder.push("controllerUninstall");
      return { ok: true };
    });
    await runUninstall(h.deps);
    expect(callOrder[0]).toBe("findPids");
    expect(callOrder).toContain("controllerUninstall");
    expect(callOrder.indexOf("findPids")).toBeLessThan(callOrder.indexOf("controllerUninstall"));
  });
});

describe("stopForegroundGhostDaemons — POSIX", () => {
  const home = "/home/testuser";

  let killSpy: ReturnType<typeof spyOn<typeof process, "kill">>;

  beforeEach(() => {
    // Capture process.kill calls per test; restore after.
    killSpy = spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns 0 killed when ps shows no ghost processes", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 0,
        stdout: "  123 /usr/bin/vim\n  456 node --version\n",
        stderr: "",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(0);
    expect(killSpy.mock.calls).toHaveLength(0);
  });

  it("identifies ghost daemon by ~/.bun/bin/ghost path", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 0,
        stdout: "  111 /home/testuser/.bun/bin/ghost daemon\n  222 unrelated\n",
        stderr: "",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);
    expect(killSpy.mock.calls).toEqual([
      [111, "SIGTERM"],
      [111, "SIGKILL"],
    ]);
  });

  it("identifies ghost daemon by ~/.ghost/ path", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 0,
        stdout: "  333 bun run /home/testuser/.ghost/workspace/bootstrap.ts\n",
        stderr: "",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);
    expect(killSpy.mock.calls.map((c) => c[0])).toEqual([333, 333]);
  });

  it("never kills the current process", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 0,
        stdout: "  4242 /home/testuser/.bun/bin/ghost uninstall\n  4243 /home/testuser/.bun/bin/ghost daemon\n",
        stderr: "",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 4242, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);
    expect(killSpy.mock.calls.map((c) => c[0])).not.toContain(4242);
    expect(killSpy.mock.calls.filter((c) => c[0] === 4243)).toHaveLength(2);
  });

  it("returns 0 killed when ps itself fails", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 1,
        stdout: "",
        stderr: "ps: command not found",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(0);
  });

  it("tolerates kill errors (already-dead pids — simulates ESRCH)", async () => {
    const spawn = makeSpawnMock({
      "ps -ax -o pid=,command=": {
        exitCode: 0,
        stdout: "  111 /home/testuser/.bun/bin/ghost daemon\n",
        stderr: "",
      },
    });
    // Simulate process already dead (ESRCH).
    killSpy.mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "linux",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);   // still reported as "attempted"
  });
});

describe("stopForegroundGhostDaemons — Windows", () => {
  const home = "C:\\Users\\testuser";

  it("returns 0 killed when PowerShell reports no matches", async () => {
    const spawn = makeSpawnMock({
      "powershell -NoProfile -Command": {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    });
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "win32",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(0);
  });

  it("parses pids from PowerShell stdout and tree-kills via taskkill", async () => {
    const taskkillCalls: string[][] = [];
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      if (cmd === "taskkill") {
        taskkillCalls.push(args);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd === "powershell") {
        return { exitCode: 0, stdout: "111\r\n222\r\n", stderr: "" };
      }
      throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
    };
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "win32",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(2);
    expect(taskkillCalls).toEqual([
      ["/F", "/T", "/PID", "111"],
      ["/F", "/T", "/PID", "222"],
    ]);
  });

  it("excludes current pid on Windows too", async () => {
    const taskkillPids: string[] = [];
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      if (cmd === "taskkill") {
        taskkillPids.push(args[args.length - 1]!);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd === "powershell") {
        return { exitCode: 0, stdout: "4242\r\n4243\r\n", stderr: "" };
      }
      throw new Error(`unexpected spawn: ${cmd}`);
    };
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "win32",
      spawn,
      currentPid: 4242, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);
    expect(taskkillPids).toEqual(["4243"]);
  });

  it("dedupes pids returned twice by the PS script (port + cmdline match)", async () => {
    const taskkillPids: string[] = [];
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      if (cmd === "taskkill") {
        taskkillPids.push(args[args.length - 1]!);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd === "powershell") {
        // Simulate the PowerShell HashSet emitting the same pid twice anyway
        // (defence — our Set-based dedupe in JS should still collapse it).
        return { exitCode: 0, stdout: "555\r\n555\r\n", stderr: "" };
      }
      throw new Error(`unexpected spawn: ${cmd}`);
    };
    const result = await stopForegroundGhostDaemons({
      home,
      platform: "win32",
      spawn,
      currentPid: 9999, gatewayPort: 15401,
    });
    expect(result.killed).toBe(1);
    expect(taskkillPids).toEqual(["555"]);
  });
});

describe("removeBunPackage", () => {
  it("returns ok with 'nothing to remove' when package absent", async () => {
    const spawn = makeSpawnMock({
      "bun pm ls -g": {
        exitCode: 0,
        stdout: "/home/user/.bun/install/global/node_modules\n├── other-pkg@1.0.0\n",
        stderr: "",
      },
    });
    const result = await removeBunPackage({ packageName: "@hyperflow.fun/ghost", spawn });
    expect(result.ok).toBe(true);
    expect(result.info).toMatch(/not found in bun global registry/);
  });

  it("runs bun remove -g when package present", async () => {
    const calls: string[] = [];
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      calls.push(key);
      if (key === "bun pm ls -g") {
        return { exitCode: 0, stdout: "├── @hyperflow.fun/ghost@0.0.2-rc.3\n", stderr: "" };
      }
      if (key === "bun remove -g @hyperflow.fun/ghost") {
        return { exitCode: 0, stdout: "removed @hyperflow.fun/ghost\n", stderr: "" };
      }
      throw new Error(`unexpected: ${key}`);
    };
    const result = await removeBunPackage({ packageName: "@hyperflow.fun/ghost", spawn });
    expect(result.ok).toBe(true);
    expect(result.info).toMatch(/Removed @hyperflow\.fun\/ghost/);
    expect(calls).toContain("bun remove -g @hyperflow.fun/ghost");
  });

  it("reports failure when bun pm ls exits non-zero (broken bun)", async () => {
    const spawn = makeSpawnMock({
      "bun pm ls -g": {
        exitCode: 2,
        stdout: "",
        stderr: "error: manifest corrupt",
      },
    });
    const result = await removeBunPackage({ packageName: "@hyperflow.fun/ghost", spawn });
    expect(result.ok).toBe(false);
    expect(result.info).toMatch(/bun pm ls -g failed/);
  });

  it("treats 'Lockfile not found' as package-absent (fresh-machine case)", async () => {
    // Real case: fresh machine with bun installed but never a global install.
    // `bun pm ls -g` exits 1 with "error: Lockfile not found" — benign,
    // means nothing to remove.
    const spawn = makeSpawnMock({
      "bun pm ls -g": {
        exitCode: 1,
        stdout: "",
        stderr: "error: Lockfile not found",
      },
    });
    const result = await removeBunPackage({ packageName: "@hyperflow.fun/ghost", spawn });
    expect(result.ok).toBe(true);
    expect(result.info).toMatch(/not found in bun global registry/);
  });

  it("reports failure when bun remove -g fails", async () => {
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "bun pm ls -g") return { exitCode: 0, stdout: "├── @hyperflow.fun/ghost@0.0.1\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "permission denied" };
    };
    const result = await removeBunPackage({ packageName: "@hyperflow.fun/ghost", spawn });
    expect(result.ok).toBe(false);
    expect(result.info).toMatch(/bun remove -g .* failed/);
  });
});

describe("stripPersistentPath — POSIX", () => {
  const home = "/home/testuser";

  function makeFsMock(files: Record<string, string>) {
    const written: Record<string, string> = {};
    const deleted: string[] = [];
    const deps = {
      existsSync: (p: string) => p in files,
      readFile: (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`);
        return files[p]!;
      },
      writeFile: (p: string, content: string) => { written[p] = content; files[p] = content; },
      unlink: (p: string) => { deleted.push(p); delete files[p]; },
    };
    return { deps, written, deleted };
  }

  it("strips GHOST-BEGIN..GHOST-END block from .bashrc", async () => {
    const rc = `export FOO=1
# GHOST-BEGIN (managed by ghost installer -- do not edit)
export PATH="/home/testuser/.bun/bin:$PATH"
# GHOST-END
alias ll="ls -la"
`;
    const fs = makeFsMock({ "/home/testuser/.bashrc": rc });
    const result = await stripPersistentPath({
      home,
      platform: "linux",
      spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ...fs.deps,
    });
    expect(result.changed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(fs.written["/home/testuser/.bashrc"]).toBe(`export FOO=1
alias ll="ls -la"
`);
  });

  it("strips legacy single-marker form", async () => {
    const rc = `export FOO=1
# Ghost (Bun global bin)
export PATH="/home/testuser/.bun/bin:$PATH"
`;
    const fs = makeFsMock({ "/home/testuser/.zshrc": rc });
    const result = await stripPersistentPath({
      home,
      platform: "darwin",
      spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ...fs.deps,
    });
    expect(result.changed).toBe(true);
    expect(fs.written["/home/testuser/.zshrc"]).toBe(`export FOO=1
`);
  });

  it("handles all three rc files in one call", async () => {
    const sentinelBlock = `# GHOST-BEGIN
export PATH="/home/testuser/.bun/bin:$PATH"
# GHOST-END
`;
    const fs = makeFsMock({
      "/home/testuser/.bashrc": sentinelBlock,
      "/home/testuser/.zshrc": sentinelBlock,
      "/home/testuser/.profile": sentinelBlock,
    });
    const result = await stripPersistentPath({
      home,
      platform: "linux",
      spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ...fs.deps,
    });
    expect(result.changed).toBe(true);
    expect(Object.keys(fs.written)).toHaveLength(3);
    for (const path of Object.keys(fs.written)) {
      expect(fs.written[path]).not.toContain("GHOST-BEGIN");
      expect(fs.written[path]).not.toContain(".bun/bin");
    }
  });

  it("is idempotent when no sentinel block present", async () => {
    const rc = `export FOO=1\nalias ll="ls -la"\n`;
    const fs = makeFsMock({ "/home/testuser/.bashrc": rc });
    const result = await stripPersistentPath({
      home,
      platform: "linux",
      spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ...fs.deps,
    });
    expect(result.changed).toBe(false);
    expect(fs.written).toEqual({});
  });

  it("warns if residual GHOST-BEGIN remains after strip (user-edited)", async () => {
    // Simulate a user manually appending GHOST-BEGIN *outside* a full block.
    // The regex won't match, so we leave it and warn.
    const rc = `# GHOST-BEGIN\nexport FOO=1\n`;  // no matching END
    const fs = makeFsMock({ "/home/testuser/.bashrc": rc });
    const result = await stripPersistentPath({
      home,
      platform: "linux",
      spawn: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      ...fs.deps,
    });
    // With an unmatched GHOST-BEGIN, the regex (non-greedy to GHOST-END) cannot match,
    // so the file is unchanged — but the verification step detects the residual marker.
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/residual/i);
  });
});

describe("stripPersistentPath — Windows", () => {
  const home = "C:\\Users\\testuser";

  it("invokes PowerShell SetEnvironmentVariable with filtered PATH", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: UninstallDeps["spawn"] = (cmd, args) => {
      calls.push({ cmd, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const result = await stripPersistentPath({
      home,
      platform: "win32",
      existsSync: () => false,
      readFile: () => "",
      writeFile: () => {},
      unlink: () => {},
      spawn,
    });
    expect(result.changed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("powershell");
    expect(calls[0]!.args).toContain("-NoProfile");
    const script = calls[0]!.args[calls[0]!.args.length - 1]!;
    // Script must:
    // - reference the User scope
    // - construct $bunBin as the home's .bun\bin path
    // - split on ';', filter out the bunBin entry, rejoin with ';'
    expect(script).toMatch(/SetEnvironmentVariable/);
    expect(script).toMatch(/'User'/);
    expect(script).toMatch(/\.bun\\\\bin/);  // Match the JSON-escaped backslashes in the path
  });

  it("reports warning when PowerShell exits non-zero", async () => {
    const spawn: UninstallDeps["spawn"] = () => ({ exitCode: 1, stdout: "", stderr: "access denied" });
    const result = await stripPersistentPath({
      home,
      platform: "win32",
      existsSync: () => false,
      readFile: () => "",
      writeFile: () => {},
      unlink: () => {},
      spawn,
    });
    expect(result.changed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/PowerShell/);
  });
});

describe("runUninstall — integration", () => {
  function makeController(status: ServiceStatus): ServiceController {
    return {
      status: async () => status,
      install: async () => ({ ok: true, definitionPath: "/tmp/ghost.plist" }),
      uninstall: async () => ({ ok: true }),
      stop: async () => {},
      restart: async () => {},
    };
  }

  it("runs full cleanup pipeline in correct order when everything is installed", async () => {
    const calls: string[] = [];
    const rcContent = `# GHOST-BEGIN\nexport PATH="/home/testuser/.bun/bin:$PATH"\n# GHOST-END\n`;
    const npmrcContent = `# GHOST-NPMRC-BEGIN\n@hyperflow.fun:registry=https://example.com/\n# GHOST-NPMRC-END\n`;
    const fileTable: Record<string, string> = {
      "/home/testuser/.bashrc": rcContent,
      "/home/testuser/.npmrc": npmrcContent,
    };
    const dataDirRemoved = { flag: false };

    await runUninstall({
      controller: makeController("running"),
      dataDir: "/home/testuser/.ghost",
      home: "/home/testuser",
      platform: "linux",
      gatewayPort: 15401,
      isTTY: true,
      confirm: async () => true,
      existsSync: (p) => p === "/home/testuser/.ghost" || p in fileTable,
      readFile: (p) => fileTable[p] ?? "",
      writeFile: (p, c) => { fileTable[p] = c; calls.push(`writeFile ${p}`); },
      unlink: (p) => { delete fileTable[p]; calls.push(`unlink ${p}`); },
      rmSync: (p) => { dataDirRemoved.flag = true; calls.push(`rmSync ${p}`); },
      spawn: (cmd, args) => {
        calls.push(`spawn ${cmd} ${args.join(" ")}`);
        if (cmd === "ps") return { exitCode: 0, stdout: "", stderr: "" };
        if (cmd === "bun" && args[0] === "pm") return { exitCode: 0, stdout: "├── @hyperflow.fun/ghost@0.0.2-rc.3\n", stderr: "" };
        if (cmd === "bun" && args[0] === "remove") return { exitCode: 0, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      log: () => {},
      err: () => {},
      exit: ((_c: number) => { throw new Error("exit called"); }) as (code: number) => never,
    });

    // Assert ordering invariants:
    const psIdx = calls.findIndex(c => c.startsWith("spawn ps"));
    const rmIdx = calls.findIndex(c => c.startsWith("rmSync"));
    const bunRemoveIdx = calls.findIndex(c => c.startsWith("spawn bun remove"));
    expect(psIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThan(psIdx);   // kill daemons before rm
    expect(bunRemoveIdx).toBeGreaterThan(0);

    // Assert end state:
    expect(dataDirRemoved.flag).toBe(true);
    expect(fileTable["/home/testuser/.bashrc"]).not.toContain("GHOST-BEGIN");
    expect("/home/testuser/.npmrc" in fileTable).toBe(false);   // deleted because emptied
  });

  it("accumulates failures and exits 1 when anything fails", async () => {
    let exitCode: number | null = null;
    await runUninstall({
      controller: makeController("running"),
      dataDir: "/home/testuser/.ghost",
      home: "/home/testuser",
      platform: "linux",
      gatewayPort: 15401,
      isTTY: true,
      confirm: async () => true,
      existsSync: () => false,
      readFile: () => "",
      writeFile: () => {},
      unlink: () => {},
      rmSync: () => {},
      spawn: (cmd) => {
        if (cmd === "bun") return { exitCode: 2, stdout: "", stderr: "bun broken" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      log: () => {},
      err: () => {},
      exit: ((c: number) => { exitCode = c; throw new Error("exit"); }) as (c: number) => never,
    }).catch(() => { /* exit throws, swallow for test */ });

    // Cast sidesteps a TS control-flow-analysis quirk: exitCode's type
    // stays narrowed to `null` (its init value) because the assignment
    // lives inside an async callback the analyzer can't see through.
    expect(exitCode as number | null).toBe(1);
  });
});

describe("stripNpmrcBlock", () => {
  const home = "/home/testuser";

  function makeFsMock(files: Record<string, string>) {
    const written: Record<string, string> = {};
    const deleted: string[] = [];
    return {
      files,
      written,
      deleted,
      deps: {
        existsSync: (p: string) => p in files,
        readFile: (p: string) => files[p] ?? (() => { throw new Error("ENOENT"); })(),
        writeFile: (p: string, content: string) => { written[p] = content; files[p] = content; },
        unlink: (p: string) => { deleted.push(p); delete files[p]; },
      },
    };
  }

  it("strips sentinel block, preserves surrounding entries", async () => {
    const npmrc = `registry=https://registry.npmjs.org/
# GHOST-NPMRC-BEGIN (managed by ghost installer -- do not edit)
@hyperflow.fun:registry=https://example.com/packages/npm/
# GHOST-NPMRC-END
loglevel=warn
`;
    const fs = makeFsMock({ "/home/testuser/.npmrc": npmrc });
    const result = await stripNpmrcBlock({ home, ...fs.deps });
    expect(result.changed).toBe(true);
    expect(result.deleted).toBe(false);
    expect(fs.written["/home/testuser/.npmrc"]).toBe(`registry=https://registry.npmjs.org/
loglevel=warn
`);
  });

  it("deletes .npmrc if emptied after strip", async () => {
    const npmrc = `# GHOST-NPMRC-BEGIN
@hyperflow.fun:registry=https://example.com/
# GHOST-NPMRC-END
`;
    const fs = makeFsMock({ "/home/testuser/.npmrc": npmrc });
    const result = await stripNpmrcBlock({ home, ...fs.deps });
    expect(result.changed).toBe(true);
    expect(result.deleted).toBe(true);
    expect(fs.deleted).toContain("/home/testuser/.npmrc");
  });

  it("no-op when file does not exist", async () => {
    const fs = makeFsMock({});
    const result = await stripNpmrcBlock({ home, ...fs.deps });
    expect(result.changed).toBe(false);
    expect(result.deleted).toBe(false);
    expect(fs.written).toEqual({});
  });

  it("no-op when sentinel block absent", async () => {
    const fs = makeFsMock({ "/home/testuser/.npmrc": `registry=https://example.com/\n` });
    const result = await stripNpmrcBlock({ home, ...fs.deps });
    expect(result.changed).toBe(false);
    expect(fs.written).toEqual({});
  });

  it("no-op with unmatched BEGIN (no END marker)", async () => {
    // Unmatched BEGIN — regex doesn't match, file unchanged.
    const npmrc = `# GHOST-NPMRC-BEGIN\nsome=entry\n`;
    const fs = makeFsMock({ "/home/testuser/.npmrc": npmrc });
    const result = await stripNpmrcBlock({ home, ...fs.deps });
    expect(result.changed).toBe(false);
  });
});

import { mkdtempSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveGatewayPortForUninstall", () => {
  // Use GHOST_CONFIG_DIR override so getConfigPath() lands inside a temp dir
  // without touching the real ~/.ghost. Reset both env vars per test.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-port-test-"));
    process.env["GHOST_CONFIG_DIR"] = tmpDir;
    delete process.env["GHOST_GATEWAY_PORT"];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env["GHOST_CONFIG_DIR"];
    delete process.env["GHOST_GATEWAY_PORT"];
  });

  it("returns 15401 default when no config and no env", () => {
    expect(resolveGatewayPortForUninstall()).toBe(15401);
  });

  it("reads gateway.port from config.json", () => {
    fsWriteFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ gateway: { port: 9999 } }),
    );
    expect(resolveGatewayPortForUninstall()).toBe(9999);
  });

  it("GHOST_GATEWAY_PORT env overrides config.json", () => {
    fsWriteFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ gateway: { port: 9999 } }),
    );
    process.env["GHOST_GATEWAY_PORT"] = "8888";
    expect(resolveGatewayPortForUninstall()).toBe(8888);
  });

  it("falls through to default on corrupt config.json", () => {
    fsWriteFileSync(join(tmpDir, "config.json"), "{ not json");
    expect(resolveGatewayPortForUninstall()).toBe(15401);
  });

  it("rejects out-of-range port and falls through to default", () => {
    fsWriteFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ gateway: { port: 99999 } }),
    );
    expect(resolveGatewayPortForUninstall()).toBe(15401);
  });
});
