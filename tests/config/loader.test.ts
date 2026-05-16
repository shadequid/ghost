import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../../src/config/loader.js";
import { ConfigError } from "../../src/core/errors.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("loadConfig missing file", () => {
  test("throws ConfigError when config file does not exist", () => {
    expect(() => loadConfig("/nonexistent/path/config.json")).toThrow(ConfigError);
  });

  test("error message includes path and onboard hint", () => {
    try {
      loadConfig("/nonexistent/path/config.json");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain("/nonexistent/path/config.json");
      expect((err as ConfigError).message).toContain("ghost onboard");
      expect((err as ConfigError).code).toBe("CONFIG_NOT_FOUND");
    }
  });
});

describe("loadConfig JSON loading", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads and parses a valid JSON config file", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({
      provider: "openai",
      model: "gpt-4o",
      gateway: { port: 9000, host: "0.0.0.0" },
    }));
    const config = loadConfig(configPath);
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.gateway.port).toBe(9000);
    expect(config.gateway.host).toBe("0.0.0.0");
  });
});

describe("loadConfig env overrides", () => {
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-env-test-"));
    const keys = ["GHOST_PROVIDER", "GHOST_MODEL", "GHOST_GATEWAY_PORT"];
    for (const k of keys) {
      saved[k] = process.env[k];
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  test("env vars override file values with correct coercion", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, "{}");

    process.env["GHOST_PROVIDER"] = "anthropic";
    process.env["GHOST_MODEL"] = "claude-3-opus";
    process.env["GHOST_GATEWAY_PORT"] = "8888";

    const config = loadConfig(configPath);
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-3-opus");
    expect(config.gateway.port).toBe(8888);
  });
});
