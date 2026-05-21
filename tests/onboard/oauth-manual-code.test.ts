import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { OAuthManager } from "../../src/auth/oauth.js";
import { registerOAuthProvider, unregisterOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { OAuthLoginCallbacks, OAuthCredentials } from "@earendil-works/pi-ai";
import { SecretStore } from "../../src/config/secrets.js";
import { CredentialStore } from "../../src/config/credentials.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_PROVIDER_ID = "test-manual-code-provider";

// ---------------------------------------------------------------------------
// OAuthManager — manual code input fallback
// ---------------------------------------------------------------------------

describe("OAuthManager.login — onManualCodeInput", () => {
  let tmpDir: string;
  let credentials: CredentialStore;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ghost-test-oauth-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const secretStore = new SecretStore(join(tmpDir, "secret.key"));
    credentials = new CredentialStore(
      join(tmpDir, "credentials.enc"),
      secretStore,
      NOOP_LOGGER.child({ module: "credentials" }),
    );

    // Register a fake provider that immediately invokes onManualCodeInput
    registerOAuthProvider({
      id: TEST_PROVIDER_ID,
      name: "Test Manual Code Provider",
      usesCallbackServer: true,
      login: async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> => {
        // Simulate the callback server failing: invoke onManualCodeInput
        const code = await callbacks.onManualCodeInput!();
        return {
          refresh: `refresh-${code}`,
          access: `access-${code}`,
          expires: Date.now() + 3600_000,
        };
      },
      refreshToken: async (creds: OAuthCredentials) => creds,
      getApiKey: (creds: OAuthCredentials) => creds.access,
    });
  });

  afterEach(() => {
    unregisterOAuthProvider(TEST_PROVIDER_ID);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("wires onManualCodeInput through to the provider and persists resulting credentials", async () => {
    const manager = new OAuthManager(credentials);

    let manualInputCalled = false;
    await manager.login(TEST_PROVIDER_ID, {
      onAuth: () => { /* no-op: callback server not used in this scenario */ },
      onPrompt: async () => "",
      onManualCodeInput: async () => {
        manualInputCalled = true;
        return "fake-code-123";
      },
    });

    expect(manualInputCalled).toBe(true);

    // Credentials were persisted — load a fresh instance to verify
    const manager2 = new OAuthManager(credentials);
    await manager2.ensureLoaded();
    expect(manager2.hasCredentials(TEST_PROVIDER_ID)).toBe(true);

    const apiKey = await manager2.getApiKey(TEST_PROVIDER_ID);
    expect(apiKey).toBe("access-fake-code-123");
  });

  it("passes the exact code returned by onManualCodeInput to the provider", async () => {
    const manager = new OAuthManager(credentials);

    await manager.login(TEST_PROVIDER_ID, {
      onAuth: () => {},
      onPrompt: async () => "",
      onManualCodeInput: async () => "exact-code-xyz",
    });

    const apiKey = await manager.getApiKey(TEST_PROVIDER_ID);
    // Provider bakes the code into both refresh and access tokens
    expect(apiKey).toBe("access-exact-code-xyz");
  });
});

