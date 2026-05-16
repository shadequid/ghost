import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerStatusMethods, resolvePackageJsonPath } from "../../src/gateway/status.js";
import { ClientManager } from "../../src/gateway/client-manager.js";
import type { VersionCheck } from "../../src/update/version-check.js";
import type { ChannelManager } from "../../src/channels/manager.js";

const silent = pino({ level: "silent" });

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

function fakeVersionCheck(latest: string | null): VersionCheck {
  return { getLatest: async () => latest };
}

describe("resolvePackageJsonPath", () => {
  test("returns the first candidate that exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "resolve-pkg-"));
    try {
      const a = join(tmp, "a-missing.json");
      const b = join(tmp, "b.json");
      writeFileSync(b, "{}");
      const c = join(tmp, "c.json");
      writeFileSync(c, "{}");

      const resolved = resolvePackageJsonPath([a, b, c]);
      expect(resolved).toBe(b);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns null when no candidate exists", () => {
    const resolved = resolvePackageJsonPath(["/nonexistent/a.json", "/nonexistent/b.json"]);
    expect(resolved).toBeNull();
  });
});

describe("status methods", () => {
  test("health returns ok", async () => {
    const reg = new MethodRegistry();
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "openai", model: "gpt-4o" } as never,
      memoryStore: {} as never,
      channels: [],
      clientManager: new ClientManager(silent),
    });
    const result = await reg.dispatch("health", makeCtx(), {});
    expect(result).toEqual({ status: "ok" });
  });

  test("status returns system info with version", async () => {
    const reg = new MethodRegistry();
    const cm = new ClientManager(silent);
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "anthropic", model: "claude-sonnet-4", verbosity: 1, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [{ name: "telegram", healthCheck: async () => true }],
      clientManager: cm,
    });
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4");
    expect(typeof result.uptime_seconds).toBe("number");
    expect(result.channels).toEqual({ telegram: true });
    expect(result.clients).toBe(0);
    expect(typeof result.version).toBe("string");
    expect(result.showToolCalls).toBe(true);
  });

  test("status reports updateAvailable=true when latestVersion > version", async () => {
    const reg = new MethodRegistry();
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "x", model: "y", verbosity: 0, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [],
      clientManager: new ClientManager(silent),
      versionCheck: fakeVersionCheck("999.0.0"),
    });
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.latestVersion).toBe("999.0.0");
    expect(result.updateAvailable).toBe(true);
  });

  test("status reports updateAvailable=false when on latest", async () => {
    const reg = new MethodRegistry();
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "x", model: "y", verbosity: 0, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [],
      clientManager: new ClientManager(silent),
      versionCheck: fakeVersionCheck("0.0.0"),
    });
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.updateAvailable).toBe(false);
  });

  test("status reports latestVersion=null when version-check returns null", async () => {
    const reg = new MethodRegistry();
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "x", model: "y", verbosity: 0, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [],
      clientManager: new ClientManager(silent),
      versionCheck: fakeVersionCheck(null),
    });
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  test("status reads channels from live manager when wired", async () => {
    const reg = new MethodRegistry();
    let liveStatus: Record<string, { running: boolean }> = {};
    const fakeManager = {
      getStatus: () => liveStatus,
    } as unknown as ChannelManager;
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "x", model: "y", verbosity: 0, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [],
      manager: fakeManager,
      clientManager: new ClientManager(silent),
    });

    liveStatus = { telegram: { running: true } };
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.channels).toEqual({ telegram: true });

    liveStatus = {};
    const after = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(after.channels).toEqual({});
  });

  test("status reports no update when versionCheck is absent", async () => {
    const reg = new MethodRegistry();
    registerStatusMethods(reg.register.bind(reg), {
      config: { provider: "x", model: "y", verbosity: 0, paper: { enabled: false } } as never,
      memoryStore: {} as never,
      channels: [],
      clientManager: new ClientManager(silent),
    });
    const result = await reg.dispatch("status", makeCtx(), {}) as Record<string, unknown>;
    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });
});
