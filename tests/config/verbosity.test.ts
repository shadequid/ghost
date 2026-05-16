/**
 * Verbosity config tests — verifies defaults, overrides, and integration
 * with the top-level configSchema.
 */

import { describe, test, expect } from "bun:test";
import { configSchema } from "../../src/config/schema.js";

// ---------------------------------------------------------------------------
// Verbosity defaults
// ---------------------------------------------------------------------------

describe("verbosity defaults", () => {
  test("defaults to 0", () => {
    const config = configSchema.parse({});
    expect(config.verbosity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Verbosity overrides
// ---------------------------------------------------------------------------

describe("verbosity overrides", () => {
  test("accepts verbosity=1 override", () => {
    const config = configSchema.parse({ verbosity: 1 });
    expect(config.verbosity).toBe(1);
  });

  test("accepts verbosity=2 override", () => {
    const config = configSchema.parse({ verbosity: 2 });
    expect(config.verbosity).toBe(2);
  });

  test("coerces string to number", () => {
    const config = configSchema.parse({ verbosity: "1" });
    expect(config.verbosity).toBe(1);
  });

  test("clamps to max 2", () => {
    expect(() => configSchema.parse({ verbosity: 3 })).toThrow();
  });

  test("rejects negative", () => {
    expect(() => configSchema.parse({ verbosity: -1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Verbosity does not affect other config sections
// ---------------------------------------------------------------------------

describe("verbosity isolation", () => {
  test("does not affect other config sections", () => {
    const config = configSchema.parse({
      verbosity: 2,
      provider: "openai",
    });
    expect(config.provider).toBe("openai");
    expect(config.gateway.port).toBe(15401);
  });

  test("old debug key is silently ignored by Zod strip", () => {
    const config = configSchema.parse({
      debug: { verbose: true, showToolCalls: true },
    });
    expect(config.verbosity).toBe(0);
    expect((config as Record<string, unknown>).debug).toBeUndefined();
  });
});
