import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: paper mode must NOT route the Hyperliquid price
 * source to testnet. Testnet has a different asset universe (BTC at index
 * 3 vs 0 on mainnet) and unrelated price levels — fetching from there
 * makes paper trading meaningless.
 *
 * A behavioral test would need to mock `HyperliquidSource` via
 * `mock.module()`, but that mock leaks across the whole process and breaks
 * the price-feed unit tests that exercise the real class. Since the fix
 * is a single literal in the gateway boot, this static check is the
 * cheapest and least-coupled regression guard.
 */

const SERVER_PATH = join(import.meta.dir, "../../src/gateway/server.ts");

describe("HyperliquidSource testnet flag", () => {
  test("price feed always reads from mainnet — paper does not toggle testnet", () => {
    const src = readFileSync(SERVER_PATH, "utf8");

    // Find the HyperliquidSource construction site.
    const ctorMatch = src.match(/new HyperliquidSource\(\{[\s\S]*?\}\)/);
    expect(ctorMatch).not.toBeNull();
    const ctorBlock = ctorMatch![0];

    // The testnet flag must be the literal `false`. A binding to
    // `paper.enabled` (or anything else that flips at runtime)
    // reintroduces the bug.
    const testnetLine = ctorBlock
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^testnet:/.test(l));
    expect(testnetLine).toBe("testnet: false,");
    expect(ctorBlock).not.toMatch(/paper[^\n]*enabled/);
  });
});
