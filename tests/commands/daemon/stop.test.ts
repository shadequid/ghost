import { describe, test, expect, mock } from "bun:test";
import { runDaemonStop, type DaemonStopDeps } from "../../../src/commands/daemon/stop.js";
import type { ServiceController, ServiceStatus } from "../../../src/services/os/controller.js";

function makeDeps(
  overrides: Omit<Partial<DaemonStopDeps>, "log" | "err" | "exit" | "controller"> & { status: ServiceStatus },
): {
  deps: DaemonStopDeps;
  logs: string[];
  errs: string[];
  exits: number[];
  readonly stopCalls: number;
} {
  const logs: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  // Tracked across tasks; asserted ==0 here, used for positive assertions in Task 2.
  const counters = { stopCalls: 0 };
  const controller: ServiceController = {
    install: mock(async () => ({ ok: true, definitionPath: "" })),
    uninstall: mock(async () => ({ ok: true })),
    stop: mock(async () => { counters.stopCalls++; }),
    restart: mock(async () => {}),
    status: mock(async () => overrides.status),
  };
  const deps: DaemonStopDeps = {
    controller,
    isTTY: true,
    confirm: async () => true,
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    exit: (code) => { exits.push(code); throw new Error(`__EXIT__${code}`); },
    ...overrides,
  };
  return {
    deps,
    logs,
    errs,
    exits,
    get stopCalls() { return counters.stopCalls; },
  };
}

describe("runDaemonStop", () => {
  test("status=not-installed → prints message, does not call stop", async () => {
    const { deps, logs, stopCalls } = makeDeps({ status: "not-installed" });
    await runDaemonStop(deps);
    expect(logs).toEqual(["Ghost daemon is not running."]);
    expect(stopCalls).toBe(0);
  });

  test("status=stopped → prints message, does not call stop", async () => {
    const { deps, logs, stopCalls } = makeDeps({ status: "stopped" });
    await runDaemonStop(deps);
    expect(logs).toEqual(["Ghost daemon is not running (service stopped, no foreground process)."]);
    expect(stopCalls).toBe(0);
  });

  test("status=running + non-TTY → errors and exits 1, does not call stop", async () => {
    const { deps, errs, exits, stopCalls } = makeDeps({ status: "running", isTTY: false });
    await expect(runDaemonStop(deps)).rejects.toThrow("__EXIT__1");
    expect(errs).toEqual(["ghost daemon stop requires an interactive terminal."]);
    expect(exits).toEqual([1]);
    expect(stopCalls).toBe(0);
  });

  test("status=running + TTY + decline → does not call stop, no output beyond confirm", async () => {
    const { deps, stopCalls } = makeDeps({
      status: "running",
      confirm: async () => false,
    });
    await runDaemonStop(deps);
    expect(stopCalls).toBe(0);
  });

  test("status=running + TTY + accept → calls stop, prints success", async () => {
    const result = makeDeps({
      status: "running",
      confirm: async () => true,
    });
    await runDaemonStop(result.deps);
    expect(result.stopCalls).toBe(1);
    expect(result.logs).toEqual(["✓ Ghost service stopped."]);
  });

  test("status=running + TTY + accept + stop throws → error printed, exits 1", async () => {
    const { deps, errs, exits } = makeDeps({ status: "running", confirm: async () => true });
    deps.controller.stop = mock(async () => { throw new Error("boom"); });
    await expect(runDaemonStop(deps)).rejects.toThrow("__EXIT__1");
    expect(errs).toEqual(["Failed to stop Ghost service: boom"]);
    expect(exits).toEqual([1]);
  });
});
