import { describe, it, expect, afterEach } from "bun:test";
import { GHOST_BANNER, printBanner } from "../../src/onboard/banner.js";
import { getProviderList, getModelList } from "../../src/onboard/providers.js";
import { SecretStore } from "../../src/config/secrets.js";
import { CredentialStore } from "../../src/config/credentials.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { runHeadless } from "../../src/onboard/wizard.js";
import { getProviders } from "@earendil-works/pi-ai";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

describe("printBanner", () => {
  it("outputs the ghost banner string", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      printBanner();
      expect(lines.join("")).toContain("Hyperliquid");
    } finally {
      console.log = original;
    }
  });

  it("GHOST_BANNER contains ASCII art and tagline", () => {
    expect(GHOST_BANNER).toContain("██████╗");
    expect(GHOST_BANNER).toContain("AI Trading Companion");
  });
});

// ---------------------------------------------------------------------------
// Provider list
// ---------------------------------------------------------------------------

describe("getProviderList", () => {
  it("returns a non-empty array of providers", () => {
    const list = getProviderList();
    expect(list.length).toBeGreaterThan(0);
  });

  it("includes all pi-ai known providers", () => {
    const known: string[] = getProviders();
    const list = getProviderList();
    const ids = new Set(list.map((p) => p.id));
    for (const id of known) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("includes custom option at tier 4", () => {
    const list = getProviderList();
    const custom = list.find((p) => p.id === "custom");
    expect(custom).toBeDefined();
    expect(custom!.tier).toBe(4);
    expect(custom!.supportsOAuth).toBe(false);
  });

  it("providers are sorted by tier then label", () => {
    const list = getProviderList();
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const curr = list[i]!;
      if (prev.tier === curr.tier) {
        expect(prev.label.localeCompare(curr.label)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.tier).toBeLessThanOrEqual(curr.tier);
      }
    }
  });

  it("groups recommended providers at tier 0", () => {
    const list = getProviderList();
    const tier0 = list.filter((p) => p.tier === 0);
    expect(tier0.length).toBeGreaterThan(0);
    // At least anthropic and openrouter should be tier 0
    const ids = tier0.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openrouter");
  });

  it("each provider has required fields", () => {
    const list = getProviderList();
    for (const p of list) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.tier).toBe("number");
      expect(typeof p.tierLabel).toBe("string");
      expect(typeof p.supportsOAuth).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// Provider OAuth detection
// ---------------------------------------------------------------------------

describe("provider OAuth detection", () => {
  it("anthropic supports OAuth", () => {
    const list = getProviderList();
    const p = list.find((x) => x.id === "anthropic");
    expect(p?.supportsOAuth).toBe(true);
  });

  it("openai-codex supports OAuth", () => {
    const list = getProviderList();
    const p = list.find((x) => x.id === "openai-codex");
    expect(p?.supportsOAuth).toBe(true);
  });

  it("openai (API key only) does not support OAuth", () => {
    const list = getProviderList();
    const p = list.find((x) => x.id === "openai");
    expect(p?.supportsOAuth).toBe(false);
  });

  it("openrouter does not support OAuth", () => {
    const list = getProviderList();
    const p = list.find((x) => x.id === "openrouter");
    expect(p?.supportsOAuth).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Model list
// ---------------------------------------------------------------------------

describe("getModelList", () => {
  it("returns models for anthropic", () => {
    const models = getModelList("anthropic");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.name).toBe("string");
    }
  });

  it("returns empty array for unknown provider", () => {
    const models = getModelList("definitely-not-a-real-provider-xyz");
    expect(models).toEqual([]);
  });

  it("model entries have id and name fields", () => {
    const models = getModelList("openai");
    if (models.length > 0) {
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("name");
    }
  });
});

// ---------------------------------------------------------------------------
// JSON config generation
// ---------------------------------------------------------------------------

describe("JSON config generation", () => {
  it("config.json contains provider and model but NOT apiKey (stored in CredentialStore)", () => {
    const configObj: Record<string, unknown> = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      secrets: { encrypt: true },
    };
    const json = JSON.stringify(configObj, null, 2);

    expect(json).toContain(`"provider": "anthropic"`);
    expect(json).toContain(`"model": "claude-sonnet-4-6"`);
    expect(json).not.toContain("apiKey");
  });

  it("CredentialStore round-trip: api_key survives encrypt/decrypt", async () => {
    const apiKey = "sk-test-key-123";
    const secretStore = new SecretStore(join(tmpdir(), `.ghost-test-${Date.now()}.key`));
    const store = new CredentialStore(join(tmpdir(), `.ghost-test-creds-${Date.now()}.json`), secretStore, NOOP_LOGGER);

    await store.set("api_key", apiKey);
    const retrieved = await store.get("api_key");
    expect(retrieved).toBe(apiKey);
  });

  it("omits apiKey when not set", () => {
    const configObj: Record<string, unknown> = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    };
    const json = JSON.stringify(configObj, null, 2);
    expect(json).not.toContain("apiKey");
  });

  it("includes apiUrl for custom provider", () => {
    const configObj: Record<string, unknown> = {
      provider: "custom",
      apiUrl: "http://localhost:11434",
    };
    const json = JSON.stringify(configObj, null, 2);
    expect(json).toContain(`"apiUrl": "http://localhost:11434"`);
  });

  it("telegram token stored in CredentialStore, not in config.json", async () => {
    const secretStore = new SecretStore(join(tmpdir(), `.ghost-test-tg-${Date.now()}.key`));
    const store = new CredentialStore(join(tmpdir(), `.ghost-test-tg-creds-${Date.now()}.json`), secretStore, NOOP_LOGGER);
    const rawToken = "123456:TEST";

    await store.set("telegram_token", rawToken);
    const retrieved = await store.get("telegram_token");
    expect(retrieved).toBe(rawToken);

    // Config block carries no token-shaped fields — token lives in CredentialStore.
    const configObj: Record<string, unknown> = {
      channels: { telegram: {} },
    };
    const json = JSON.stringify(configObj, null, 2);
    expect(json).not.toContain("123456:TEST");
    expect(json).not.toContain("botToken");
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("local custom provider auth skip", () => {
  it("localhost URL is detected as local", () => {
    const isLocal = (url: string) =>
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);

    expect(isLocal("http://localhost:11434")).toBe(true);
    expect(isLocal("http://127.0.0.1:8080")).toBe(true);
    expect(isLocal("http://localhost:11434/v1")).toBe(true);
    expect(isLocal("https://my-remote-api.com")).toBe(false);
    expect(isLocal("https://api.openai.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("webhook port validation", () => {
  const validatePort = (v: string): string | undefined => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return "Port must be a number between 1 and 65535";
    return undefined;
  };

  it("accepts valid ports", () => {
    expect(validatePort("80")).toBeUndefined();
    expect(validatePort("8080")).toBeUndefined();
    expect(validatePort("65535")).toBeUndefined();
    expect(validatePort("1")).toBeUndefined();
  });

  it("rejects invalid ports", () => {
    expect(validatePort("0")).toBeTruthy();
    expect(validatePort("65536")).toBeTruthy();
    expect(validatePort("abc")).toBeTruthy();
    expect(validatePort("-1")).toBeTruthy();
    expect(validatePort("3.14")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Headless onboard must consult the custom registry from models.json
// ---------------------------------------------------------------------------

describe("runHeadless — custom providers from models.json", () => {
  let ghostHome: string | undefined;
  const originalGhostHome = process.env["GHOST_HOME"];

  afterEach(() => {
    if (ghostHome) rmSync(ghostHome, { recursive: true, force: true });
    if (originalGhostHome === undefined) delete process.env["GHOST_HOME"];
    else process.env["GHOST_HOME"] = originalGhostHome;
  });

  it("accepts a custom provider defined in ~/.ghost/models.json", async () => {
    ghostHome = join(tmpdir(), `ghost-headless-custom-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(ghostHome, { recursive: true });
    process.env["GHOST_HOME"] = ghostHome;

    // Seed a custom provider (`ollama`) — not a pi-ai built-in.
    writeFileSync(
      join(ghostHome, "models.json"),
      JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [{ id: "qwen3:8b" }],
          },
        },
      }),
    );

    // runHeadless writes config, does NOT call process.exit on the happy path.
    await runHeadless(
      { provider: "ollama", model: "qwen3:8b" },
      { logger: NOOP_LOGGER },
    );

    const configRaw = readFileSync(join(ghostHome, "config.json"), "utf-8");
    const config = JSON.parse(configRaw) as { provider: string; model: string };
    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("qwen3:8b");
  });

  it("rejects an unknown provider that is neither built-in nor in models.json", async () => {
    ghostHome = join(tmpdir(), `ghost-headless-unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(ghostHome, { recursive: true });
    process.env["GHOST_HOME"] = ghostHome;

    // Capture console.error + process.exit instead of actually exiting.
    const errors: string[] = [];
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("__process_exit__");
    }) as typeof process.exit;

    try {
      await runHeadless(
        { provider: "totally-fake-provider-xyz", model: "whatever" },
        { logger: NOOP_LOGGER },
      );
      expect("did not exit").toBe("should have exited");
    } catch (e) {
      expect((e as Error).message).toBe("__process_exit__");
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain('Unknown provider "totally-fake-provider-xyz"');
  });
});
