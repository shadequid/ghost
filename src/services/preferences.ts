/**
 * PreferenceStore — generic key/value persistence over the settings_kv table.
 *
 * YAGNI: no namespace registry, no per-key schema validation. Typed accessors
 * are added only for keys consumed by existing features. New preferences get a
 * dedicated typed pair here; callers that need raw access use get/set directly.
 */

import type { Database, Statement } from "bun:sqlite";
import type { Logger } from "pino";

export const TWEET_FILTER_PROMPT_KEY = "tweets.filter_prompt";
export const NEWS_FILTER_PROMPT_KEY = "news.filter_prompt";

interface Stmts {
  get: Statement;
  upsert: Statement;
  delete: Statement;
}

export class PreferenceStore {
  private readonly log: Logger;
  private readonly stmts: Stmts;

  constructor(private readonly db: Database, logger: Logger) {
    this.log = logger;
    this.stmts = {
      get: db.prepare(`SELECT value FROM settings_kv WHERE key = ?`),
      upsert: db.prepare(`
        INSERT INTO settings_kv (key, value, updated_at)
        VALUES (?, ?, unixepoch())
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
      `),
      delete: db.prepare(`DELETE FROM settings_kv WHERE key = ?`),
    };
  }

  get(key: string): string | null {
    const row = this.stmts.get.get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.stmts.upsert.run(key, value);
    this.log.debug({ key }, "preference set");
  }

  delete(key: string): void {
    this.stmts.delete.run(key);
    this.log.debug({ key }, "preference deleted");
  }

  getTweetFilterPrompt(): string | null {
    return this.get(TWEET_FILTER_PROMPT_KEY);
  }

  // Empty string clears the override so the default selector reactivates.
  setTweetFilterPrompt(prompt: string): void {
    if (prompt.length === 0) this.delete(TWEET_FILTER_PROMPT_KEY);
    else this.set(TWEET_FILTER_PROMPT_KEY, prompt);
  }

  getNewsFilterPrompt(): string | null {
    return this.get(NEWS_FILTER_PROMPT_KEY);
  }

  setNewsFilterPrompt(prompt: string): void {
    if (prompt.length === 0) this.delete(NEWS_FILTER_PROMPT_KEY);
    else this.set(NEWS_FILTER_PROMPT_KEY, prompt);
  }
}
