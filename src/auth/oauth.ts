import { getOAuthProvider, getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderId } from "@mariozechner/pi-ai";
import type { CredentialStore } from "../config/credentials.js";

export const OAUTH_PROVIDERS = ["anthropic", "openai-codex", "github-copilot", "gemini-cli", "antigravity"] as const;
export type SupportedOAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

/**
 * Manages OAuth credentials for subscription-based LLM providers.
 * Credentials stored in CredentialStore as oauth/{providerId} keys.
 */
export class OAuthManager {
  private oauthCreds: Record<string, OAuthCredentials> = {};
  private loaded = false;

  constructor(private readonly store: CredentialStore) {}

  /** Load all oauth/* credentials from store into memory. */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const keys = await this.store.keys();
      for (const key of keys) {
        if (!key.startsWith("oauth/")) continue;
        const providerId = key.slice("oauth/".length);
        const raw = await this.store.get(key);
        if (raw) {
          try {
            this.oauthCreds[providerId] = JSON.parse(raw) as OAuthCredentials;
          } catch {
            // Corrupt entry — skip
          }
        }
      }
    } catch (err) {
      this.loaded = false;
      throw err;
    }
  }

  /** Run the OAuth login flow for a provider and save resulting credentials. */
  async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void> {
    await this.load();

    const provider = getOAuthProvider(providerId);
    if (!provider) {
      throw new Error(`OAuth provider "${providerId}" not found. Available: ${OAUTH_PROVIDERS.join(", ")}`);
    }

    const newCredentials = await provider.login(callbacks);
    this.oauthCreds[providerId] = newCredentials;
    await this.store.set(`oauth/${providerId}`, JSON.stringify(newCredentials));
  }

  /**
   * Get API key for a provider from stored OAuth credentials.
   * Auto-refreshes expired tokens and saves the updated credentials.
   * Returns null if no credentials exist for the provider.
   */
  async getApiKey(providerId: OAuthProviderId): Promise<string | null> {
    await this.load();

    if (!this.oauthCreds[providerId]) return null;

    const oldAccess = this.oauthCreds[providerId]?.access;
    const result = await getOAuthApiKey(providerId, this.oauthCreds);
    if (!result) return null;

    // Only save when credentials actually changed
    if (result.newCredentials.access !== oldAccess) {
      this.oauthCreds[providerId] = result.newCredentials;
      await this.store.set(`oauth/${providerId}`, JSON.stringify(result.newCredentials));
    }

    return result.apiKey;
  }

  /** Check if provider has stored OAuth credentials. */
  hasCredentials(providerId: string): boolean {
    return providerId in this.oauthCreds;
  }

  /** List providers with active credentials. */
  listAuthenticated(): string[] {
    return Object.keys(this.oauthCreds);
  }

  /**
   * Ensure credentials are loaded.
   * Call this before checking hasCredentials() if credentials may not be loaded yet.
   */
  async ensureLoaded(): Promise<void> {
    await this.load();
  }
}
