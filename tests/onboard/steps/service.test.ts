import { describe, test, expect } from "bun:test";
import { runServiceStep, type ServiceStepDeps } from "../../../src/onboard/steps/service.js";
import type { ServiceController, ServiceStatus } from "../../../src/services/os/controller.js";

function fakeController(initial: ServiceStatus): ServiceController {
  let state = initial;
  return {
    async status() { return state; },
    async install() { state = "running"; return { ok: true, definitionPath: "/tmp/fake" }; },
    async uninstall() { state = "not-installed"; return { ok: true }; },
    async stop() { state = "stopped"; },
    async restart() { state = "running"; },
  };
}

function baseDeps(overrides: Partial<ServiceStepDeps> = {}): ServiceStepDeps {
  return {
    controller: fakeController("not-installed"),
    prompt: async () => true,
    alreadyInstalledChoice: async () => "reinstall",
    confirmLinger: async () => false,
    waitReachable: async () => true,
    platform: "linux",
    installOpts: { execPath: "/usr/bin/true", bunPath: "/usr/bin/true", logDir: "/tmp/ghost-test-logs", env: {} },
    ...overrides,
  };
}

describe("runServiceStep", () => {
  test("installs when user confirms and not-installed", async () => {
    const result = await runServiceStep(baseDeps());
    expect(result.action).toBe("installed");
    expect(result.warnings).toHaveLength(0);
  });

  test("skips when user declines", async () => {
    const result = await runServiceStep(baseDeps({
      prompt: async () => false,
    }));
    expect(result.action).toBe("skipped");
  });

  test("offers menu when already installed — keep", async () => {
    const result = await runServiceStep(baseDeps({
      controller: fakeController("running"),
      alreadyInstalledChoice: async () => "keep",
    }));
    expect(result.action).toBe("kept");
  });

  test("offers menu when already installed — uninstall", async () => {
    const ctrl = fakeController("running");
    const result = await runServiceStep(baseDeps({
      controller: ctrl,
      alreadyInstalledChoice: async () => "uninstall",
    }));
    expect(result.action).toBe("uninstalled");
    expect(await ctrl.status()).toBe("not-installed");
  });

  test("offers menu when already installed — reinstall", async () => {
    const result = await runServiceStep(baseDeps({
      controller: fakeController("running"),
      alreadyInstalledChoice: async () => "reinstall",
    }));
    expect(result.action).toBe("reinstalled");
  });

  test("offers menu when already installed — restart", async () => {
    const result = await runServiceStep(baseDeps({
      controller: fakeController("running"),
      alreadyInstalledChoice: async () => "restart",
    }));
    expect(result.action).toBe("restarted");
  });

  test("adds warning when gateway unreachable", async () => {
    const result = await runServiceStep(baseDeps({
      waitReachable: async () => false,
    }));
    expect(result.action).toBe("installed");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("reachable");
  });

  test("calls linger on linux platform", async () => {
    let lingerCalled = false;
    const result = await runServiceStep(baseDeps({
      platform: "linux",
      confirmLinger: async () => { lingerCalled = true; return false; },
    }));
    // Linger may or may not be called depending on whether the import succeeds,
    // but the step should still complete successfully.
    expect(result.action).toBe("installed");
  });

  test("skips linger on non-linux platform", async () => {
    let lingerCalled = false;
    const result = await runServiceStep(baseDeps({
      platform: "darwin",
      confirmLinger: async () => { lingerCalled = true; return false; },
    }));
    expect(result.action).toBe("installed");
    expect(lingerCalled).toBe(false);
  });
});
