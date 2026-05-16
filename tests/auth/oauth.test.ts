import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { SecretStore } from "../../src/config/secrets.js";
import { CredentialStore } from "../../src/config/credentials.js";
import { NOOP_LOGGER } from "../../src/logger.js";

// ---------------------------------------------------------------------------
// Mock @mariozechner/pi-ai OAuth functions
// Must be declared before any import of modules that use pi-ai
// ---------------------------------------------------------------------------

const mockCredentials: OAuthCredentials = {
  access: "access-token-123",
  refresh: "refresh-token-456",
  expires: Date.now() + 3600_000,
};

const mockRefreshedCredentials: OAuthCredentials = {
  access: "access-token-refreshed",
  refresh: "refresh-token-456",
  expires: Date.now() + 7200_000,
};

const mockGetApiKeyResult: { newCredentials: OAuthCredentials; apiKey: string } = {
  newCredentials: mockRefreshedCredentials,
  apiKey: "sk-oauth-api-key",
};

let mockGetOAuthApiKeyImpl: (
  providerId: string,
  credentials: Record<string, OAuthCredentials>
) => Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> = async () => mockGetApiKeyResult;

const mockProviderLogin = mock(async (_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> => mockCredentials);

const mockGetOAuthProvider = mock((_id: string) => ({
  id: "anthropic",
  name: "Anthropic",
  login: mockProviderLogin,
  refreshToken: async (c: OAuthCredentials) => c,
  getApiKey: (c: OAuthCredentials) => c.access,
}));



// Mock the oauth sub-path used by OAuthManager
mock.module("@mariozechner/pi-ai/oauth", () => ({
  getOAuthProvider: mockGetOAuthProvider,
  getOAuthApiKey: async (providerId: string, credentials: Record<string, OAuthCredentials>) =>
    mockGetOAuthApiKeyImpl(providerId, credentials),
}));

// Import after mocking
const { OAuthManager } = await import("../../src/auth/oauth.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir = "";

function makeCredentialStore(): CredentialStore {
  const secretStore = new SecretStore(join(tempDir, ".secret_key"));
  return new CredentialStore(join(tempDir, "credentials.json"), secretStore, NOOP_LOGGER);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ghost-oauth-test-"));
  mockProviderLogin.mockReset();
  mockProviderLogin.mockImplementation(async () => mockCredentials);
  mockGetOAuthProvider.mockReset();
  mockGetOAuthProvider.mockImplementation((_id: string) => ({
    id: "anthropic",
    name: "Anthropic",
    login: mockProviderLogin,
    refreshToken: async (c: OAuthCredentials) => c,
    getApiKey: (c: OAuthCredentials) => c.access,
  }));
  mockGetOAuthApiKeyImpl = async () => mockGetApiKeyResult;

});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Credential save / load / encrypt round-trip
// ---------------------------------------------------------------------------

describe("OAuthManager — credential save/load round-trip", () => {
  test("credentials saved and reloaded successfully", async () => {
    const store = makeCredentialStore();
    const mgr1 = new OAuthManager(store);
    await mgr1.login("anthropic", {
      onAuth: () => {},
      onPrompt: async () => "",
    });

    // New instance, same store — should load from disk
    const store2 = makeCredentialStore();
    const mgr2 = new OAuthManager(store2);
    await mgr2.ensureLoaded();

    expect(mgr2.hasCredentials("anthropic")).toBe(true);
    expect(mgr2.listAuthenticated()).toEqual(["anthropic"]);
  });

  test("credentials file is written with 0o600 permissions", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", {
      onAuth: () => {},
      onPrompt: async () => "",
    });

    const credPath = join(tempDir, "credentials.json");
    expect(existsSync(credPath)).toBe(true);
    const stats = statSync(credPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test("credentials file contains encrypted blob (not plaintext tokens)", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", {
      onAuth: () => {},
      onPrompt: async () => "",
    });

    const credPath = join(tempDir, "credentials.json");
    const raw = readFileSync(credPath, "utf-8");
    // Should not contain the raw access token
    expect(raw).not.toContain("access-token-123");
    // Should contain the encrypted field
    const parsed = JSON.parse(raw) as { encrypted: string };
    expect(parsed.encrypted).toMatch(/^enc2:/);
  });

  test("no credentials file when no login performed", () => {
    const credPath = join(tempDir, "credentials.json");
    expect(existsSync(credPath)).toBe(false);
  });

  test("re-login overwrites previous credentials for provider", async () => {
    const updatedCreds: OAuthCredentials = {
      access: "new-access-token",
      refresh: "new-refresh-token",
      expires: Date.now() + 3600_000,
    };

    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });

    // Second login with different creds
    mockProviderLogin.mockImplementation(async () => updatedCreds);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });

    // New manager loads updated creds — getApiKey still returns mock result
    const store2 = makeCredentialStore();
    const mgr2 = new OAuthManager(store2);
    const key = await mgr2.getApiKey("anthropic");
    expect(key).toBe("sk-oauth-api-key");
  });
});

// ---------------------------------------------------------------------------
// getApiKey — OAuth key resolution
// ---------------------------------------------------------------------------

describe("OAuthManager — getApiKey", () => {
  test("returns OAuth API key when credentials exist", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });

    const key = await mgr.getApiKey("anthropic");
    expect(key).toBe("sk-oauth-api-key");
  });

  test("returns null when no credentials for provider", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.ensureLoaded();

    const key = await mgr.getApiKey("anthropic");
    expect(key).toBeNull();
  });

  test("returns null when getOAuthApiKey returns null", async () => {
    mockGetOAuthApiKeyImpl = async () => null;

    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });

    const key = await mgr.getApiKey("anthropic");
    expect(key).toBeNull();
  });

  test("saves refreshed credentials after getApiKey", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });
    await mgr.getApiKey("anthropic");

    // Reload — should still have credentials
    const store2 = makeCredentialStore();
    const mgr2 = new OAuthManager(store2);
    await mgr2.ensureLoaded();
    expect(mgr2.hasCredentials("anthropic")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasCredentials / listAuthenticated
// ---------------------------------------------------------------------------

describe("OAuthManager — hasCredentials / listAuthenticated", () => {
  test("hasCredentials returns false before login", () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    expect(mgr.hasCredentials("anthropic")).toBe(false);
  });

  test("hasCredentials returns true after login", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });
    expect(mgr.hasCredentials("anthropic")).toBe(true);
  });

  test("listAuthenticated returns empty array before login", () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    expect(mgr.listAuthenticated()).toEqual([]);
  });

  test("listAuthenticated returns provider after login", async () => {
    const store = makeCredentialStore();
    const mgr = new OAuthManager(store);
    await mgr.login("anthropic", { onAuth: () => {}, onPrompt: async () => "" });
    expect(mgr.listAuthenticated()).toContain("anthropic");
  });
});

// PiAiProvider tests removed — PiAiProvider deleted in Epic 18.
// OAuth key resolution is now handled via Agent.getApiKey() hook in runtime.ts.
