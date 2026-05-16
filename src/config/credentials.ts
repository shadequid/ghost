/**
 * CredentialStore — unified encrypted storage for all secrets.
 *
 * Key-value store backed by SecretStore encryption.
 * All secrets (API keys, OAuth tokens, wallet keys, bot tokens) stored here.
 * File: ~/.ghost/credentials.json (encrypted blob, 0o600 permissions).
 *
 * Key naming convention:
 *   api_key          — LLM provider API key
 *   oauth/{provider} — OAuth credentials JSON
 *   wallet/{address} — Wallet private key
 *   telegram_token   — Telegram bot token
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SecretStore } from "./secrets.js";
import type { Logger } from "pino";

export class CredentialStore {
  private data: Record<string, string> = {};
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly secretStore: SecretStore,
    private readonly log: Logger,
  ) {}

  /** Load and decrypt credentials from disk. Deduplicates concurrent calls. */
  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return;
      const blob = JSON.parse(raw) as { encrypted: string };
      const decrypted = await this.secretStore.decrypt(blob.encrypted);
      this.data = JSON.parse(decrypted) as Record<string, string>;
    } catch (err) {
      this.log.warn({ err, path: this.filePath }, "failed to load credentials");
      this.data = {};
    }
  }

  /** Encrypt and save all credentials to disk with 0o600 permissions. */
  async save(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const plaintext = JSON.stringify(this.data);
    const encrypted = await this.secretStore.encrypt(plaintext);
    writeFileSync(this.filePath, JSON.stringify({ encrypted }), { mode: 0o600 });
  }

  /** Get a credential by key. Returns null if not found. */
  async get(key: string): Promise<string | null> {
    await this.load();
    return this.data[key] ?? null;
  }

  /** Set a credential. Saves immediately. */
  async set(key: string, value: string): Promise<void> {
    await this.load();
    this.data = { ...this.data, [key]: value };
    await this.save();
  }

  /** Delete a credential. Saves immediately. */
  async delete(key: string): Promise<boolean> {
    await this.load();
    if (!(key in this.data)) return false;
    const { [key]: _, ...rest } = this.data;
    this.data = rest;
    await this.save();
    return true;
  }

  /** List all credential keys. */
  async keys(): Promise<string[]> {
    await this.load();
    return Object.keys(this.data);
  }

  /** Check if a credential exists. */
  async has(key: string): Promise<boolean> {
    await this.load();
    return key in this.data;
  }
}
