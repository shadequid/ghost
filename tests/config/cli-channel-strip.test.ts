/**
 * Config schema: telegram field round-trips correctly.
 * Replaces the old "channels as generic record" test — the schema now
 * has a typed `telegram` field instead of a generic `channels` record.
 */

import { describe, test, expect } from "bun:test";
import { configSchema } from "../../src/config/schema.js";

describe("Config schema: telegram field", () => {
  test("default config has no telegram field", () => {
    const parsed = configSchema.parse({});
    expect(parsed.telegram).toBeUndefined();
  });

  test("telegram block round-trips through schema", () => {
    const parsed = configSchema.parse({
      telegram: { streaming: true, replyToMessage: true, reactEmoji: "🔥" },
    });
    expect(parsed.telegram).toBeDefined();
    expect(parsed.telegram?.streaming).toBe(true);
    expect(parsed.telegram?.replyToMessage).toBe(true);
    expect(parsed.telegram?.reactEmoji).toBe("🔥");
  });

  test("telegram block uses defaults for missing fields", () => {
    const parsed = configSchema.parse({ telegram: {} });
    expect(parsed.telegram?.streaming).toBe(true);
    expect(parsed.telegram?.replyToMessage).toBe(false);
    expect(parsed.telegram?.reactEmoji).toBe("");
  });

  test("legacy channels key is ignored (not in schema)", () => {
    // Pre-migration config still parses — Zod strips unknown keys
    const parsed = configSchema.parse({
      channels: { telegram: { streaming: false } },
    });
    // channels field is stripped by Zod strict parsing
    expect((parsed as Record<string, unknown>)["channels"]).toBeUndefined();
    expect(parsed.telegram).toBeUndefined();
  });
});
