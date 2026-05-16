import { describe, it, expect } from "bun:test";
import { priceHandler } from "../../../../src/channels/telegram/commands/price.js";
import { makeCtx, makeTicker } from "./helpers.js";

/** Handlers may return string|string[]; /price always returns a single
 *  string. Coerce with a guard to keep test assertions ergonomic. */
function s(reply: string | string[]): string {
  if (typeof reply !== "string") throw new Error("expected single-string reply");
  return reply;
}

describe("priceHandler", () => {
  it("renders `<SYMBOL> Price` header + indented `‐ Label: value` rows", async () => {
    const ctx = makeCtx({
      getTicker: async (sym) => makeTicker(sym, {
        markPrice: 65_000.5,
        oraclePrice: 65_010,
        priceChangePct24h: 2.5,
        volume24h: 1_234_567_890,
        openInterest: 12_345_678,
        fundingRate: 0.0001,
      }),
    });
    const out = s(await priceHandler(ctx, ["BTC"]));
    // Header: `<SYMBOL> Price`, no venue suffix
    expect(out).toContain("**BTC Price**");
    expect(out).not.toContain("Hyperliquid");
    // Plain Telegram message — no <pre> code block
    expect(out).not.toContain("<pre>");
    // Price row carries spotlight value + 🟢 + signed 24h pct
    expect(out).toContain("   ‐ Price: $65,000.50 🟢 +2.50% (24h)");
    // Indented `‐ Label: value` metadata rows (U+2010 hyphen)
    expect(out).toContain("   ‐ Volume 24h: $1.23B");
    expect(out).toContain("   ‐ Open Interest: $12.35M");
    expect(out).toContain("   ‐ Funding: +1.00 bps/h");
    // No ASCII-hyphen variant should slip through (would be rewritten to `•`)
    expect(out).not.toContain("   - Volume");
    expect(out).not.toContain("• Volume");
    // No decorative per-row emojis or bull/bear verdict
    expect(out).not.toContain("📊");
    expect(out).not.toContain("🔮");
    expect(out).not.toContain("📈");
    expect(out).not.toContain("📦");
    expect(out).not.toContain("⚡");
    expect(out).not.toContain("🐂");
    expect(out).not.toContain("🐻");
  });

  it("uses 🔴 on negative 24h and signs funding negatively", async () => {
    const ctx = makeCtx({
      getTicker: async (sym) => makeTicker(sym, {
        priceChangePct24h: -3.2,
        fundingRate: -0.0002,
      }),
    });
    const out = s(await priceHandler(ctx, ["BTC"]));
    expect(out).toContain("🔴 -3.20% (24h)");
    expect(out).toContain("-2.00 bps/h");
    expect(out).not.toContain("🟢");
  });

  it("hides Oracle row when spread vs Mark is below threshold", async () => {
    const ctx = makeCtx({
      getTicker: async (sym) => makeTicker(sym, {
        markPrice: 65_000,
        oraclePrice: 65_010, // 0.015% spread — under 0.05%
      }),
    });
    const out = s(await priceHandler(ctx, ["BTC"]));
    expect(out).not.toContain("Oracle");
  });

  it("shows Oracle row when spread vs Mark exceeds threshold", async () => {
    const ctx = makeCtx({
      getTicker: async (sym) => makeTicker(sym, {
        markPrice: 65_000,
        oraclePrice: 65_500, // 0.77% spread — over 0.05%
      }),
    });
    const out = s(await priceHandler(ctx, ["BTC"]));
    expect(out).toContain("   ‐ Oracle: 65,500.00");
  });

  it("compacts USD for B/M/K/sub-thousand", async () => {
    const ctx = makeCtx({
      getTicker: async (sym) => makeTicker(sym, {
        volume24h: 5_678_900_000,
        openInterest: 999.5,
      }),
    });
    const out = s(await priceHandler(ctx, ["X"]));
    expect(out).toContain("$5.68B");
    expect(out).toContain("$999.50");
  });

  it("uppercases symbol arg before lookup", async () => {
    let received = "";
    const ctx = makeCtx({
      getTicker: async (sym) => {
        received = sym;
        return makeTicker(sym);
      },
    });
    await priceHandler(ctx, ["btc"]);
    expect(received).toBe("BTC");
  });

  it("returns usage hint when no arg", async () => {
    const ctx = makeCtx();
    const out = s(await priceHandler(ctx, []));
    expect(out.toLowerCase()).toContain("usage");
    expect(out).toContain("/price");
  });

  it("returns usage hint when too many args", async () => {
    const ctx = makeCtx();
    const out = s(await priceHandler(ctx, ["BTC", "ETH"]));
    expect(out.toLowerCase()).toContain("usage");
  });

  it("returns a friendly message for unknown symbol errors", async () => {
    const ctx = makeCtx({
      getTicker: async () => { throw new Error("Unknown asset: XYZ"); },
    });
    const out = s(await priceHandler(ctx, ["XYZ"]));
    expect(out).toContain("XYZ");
    expect(out.toLowerCase()).toContain("not found");
    expect(out.toLowerCase()).toContain("hyperliquid");
  });

  it("returns friendly hint for live-client `Unknown asset: <SYM> (resolved: …)` shape", async () => {
    const ctx = makeCtx({
      getTicker: async () => { throw new Error("Unknown asset: XYZ (resolved: XYZ-PERP)"); },
    });
    const out = s(await priceHandler(ctx, ["XYZ"]));
    expect(out.toLowerCase()).toContain("not found");
  });

  it("propagates non-symbol (network/transient) errors to dispatcher", async () => {
    const ctx = makeCtx({
      getTicker: async () => { throw new Error("ECONNRESET socket hang up"); },
    });
    await expect(priceHandler(ctx, ["BTC"])).rejects.toThrow(/ECONNRESET/);
  });

  // bare "invalid request" / "unknown" must not be misclassified
  // as "symbol not found" — these come from upstream 4xx wrappers and
  // should propagate so the user doesn't blame their input.
  it("propagates 4xx 'invalid request' as a transient error", async () => {
    const ctx = makeCtx({
      getTicker: async () => { throw new Error("Hyperliquid info: 400 invalid request"); },
    });
    await expect(priceHandler(ctx, ["BTC"])).rejects.toThrow(/invalid request/);
  });

  it("propagates bare 'unknown error' as transient — not a not-found hint", async () => {
    const ctx = makeCtx({
      getTicker: async () => { throw new Error("unknown error in axios adapter"); },
    });
    await expect(priceHandler(ctx, ["BTC"])).rejects.toThrow(/unknown error/);
  });
});
