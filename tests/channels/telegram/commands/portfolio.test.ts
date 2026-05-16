import { describe, it, expect } from "bun:test";
import { portfolioHandler } from "../../../../src/channels/telegram/commands/portfolio.js";
import { makeCtx, makeWalletInfo, makeBalance, makePosition } from "./helpers.js";

function asString(reply: string | string[]): string {
  if (typeof reply !== "string") throw new Error("expected single-string reply");
  return reply;
}

function asArray(reply: string | string[]): string[] {
  if (!Array.isArray(reply)) throw new Error("expected string[] reply");
  return reply;
}

describe("/portfolio handler — overview format", () => {
  it("replies with no-wallet message when none are connected", async () => {
    const out = asString(await portfolioHandler(makeCtx(), []));
    expect(out).toBe("No wallet connected. Use the agent to connect one.");
  });

  it("renders header + indented `‐ Label: value` rows + positions block", async () => {
    const out = asString(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getBalance: async () => makeBalance({
        totalEquity: 12_480.32,
        availableBalance: 4_210,
        usedMargin: 8_270.32,
        unrealizedPnl: 284.10,
      }),
      getPositions: async () => [
        makePosition({ symbol: "BTC", side: "long", unrealizedPnl: 184.20, unrealizedPnlPct: 1.62 }),
        makePosition({ symbol: "ETH", side: "short", unrealizedPnl: 112.40, unrealizedPnlPct: 0.98 }),
      ],
    }), []));

    // No <pre> code block — plain Telegram message
    expect(out).not.toContain("<pre>");

    // Header: always shows wallet label, even for single wallet
    expect(out).toContain("**Portfolio** | 0xaaaa...aaaa");
    expect(out).not.toContain("👛");

    // No spotlight line — overview is the indented rows + positions
    expect(out).not.toContain("**$12,480.32**");
    expect(out).not.toContain("🟢");
    expect(out).not.toContain("🔴");

    // Indented `‐ Label: value` balance rows (U+2010 hyphen, not ASCII -
    // so the formatter pipeline can't rewrite it to `•`)
    expect(out).toContain("   ‐ Equity: $12,480.32");
    expect(out).toContain("   ‐ Free margin: $4,210.00");
    expect(out).toContain("   ‐ Used margin: $8,270.32");
    // No ASCII-hyphen variant should slip through
    expect(out).not.toContain("   - Equity");
    expect(out).not.toContain("• Equity");

    // Positions block — bold header + indented rows
    expect(out).toContain("**Positions (2)**");
    expect(out).toContain("   ‐ BTC Long");
    expect(out).toContain("   ‐ ETH Short");
    expect(out).toContain("+$184.20");
    expect(out).toContain("(+1.62%)");

    // Open orders + per-position detail dropped from overview
    expect(out).not.toContain("Open orders");
    expect(out).not.toContain("No open orders");
    expect(out).not.toContain("Liq:");
    expect(out).not.toContain("Entry / Mark");
    expect(out).not.toContain("Margin:");
  });

  it("renders the same indented row format when PnL is zero (no spotlight)", async () => {
    const out = asString(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getBalance: async () => makeBalance({
        totalEquity: 10000, availableBalance: 10000, usedMargin: 0, unrealizedPnl: 0,
      }),
      getPositions: async () => [],
    }), []));
    expect(out).toContain("**Portfolio** | 0xaaaa...aaaa");
    expect(out).toContain("   ‐ Equity: $10,000.00");
    expect(out).toContain("   ‐ Free margin: $10,000.00");
    expect(out).toContain("   ‐ Used margin: $0.00");
    expect(out).not.toContain("**$10,000.00**");
    expect(out).not.toContain("• Equity");
  });

  it("renders signed minus on negative PnL inside the position row", async () => {
    const out = asString(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getBalance: async () => makeBalance({ totalEquity: 1000, unrealizedPnl: -54.05 }),
      getPositions: async () => [
        makePosition({ symbol: "BTC", side: "long", unrealizedPnl: -54.05, unrealizedPnlPct: -5.41 }),
      ],
    }), []));
    expect(out).toContain("   ‐ BTC Long  -$54.05 (-5.41%)");
    // No 🔴 — direction emoji was removed from /portfolio.
    expect(out).not.toContain("🔴");
  });

  it("returns one message per wallet for multi-wallet (string[])", async () => {
    const w1 = "0x1111111111111111111111111111111111111111";
    const w2 = "0x2222222222222222222222222222222222222222";
    const balances = new Map([
      [w1, makeBalance({ totalEquity: 100 })],
      [w2, makeBalance({ totalEquity: 200 })],
    ]);
    const positions = new Map([
      [w1, [makePosition({ symbol: "BTC" })]],
      [w2, [makePosition({ symbol: "ETH", side: "short", unrealizedPnl: -50, unrealizedPnlPct: -2.1 })]],
    ]);
    const messages = asArray(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo(w1), makeWalletInfo(w2)],
      getBalance: async (a?: string) => balances.get(a ?? "")!,
      getPositions: async (a?: string) => positions.get(a ?? "") ?? [],
    }), []));

    expect(messages.length).toBe(2);
    // Each carries a wallet label so the recipient can tell them apart
    expect(messages[0]).toContain("0x1111...1111");
    expect(messages[1]).toContain("0x2222...2222");
    // First wallet has BTC Long; second has ETH Short
    expect(messages[0]).toContain("BTC Long");
    expect(messages[1]).toContain("ETH Short");
  });

  it("renders an error message in place when balance fetch fails", async () => {
    const out = asString(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getBalance: async () => { throw new Error("balance rpc down"); },
    }), []));
    expect(out).toContain("(failed: balance rpc down)");
  });

  it("isolates per-wallet failures across messages", async () => {
    const w1 = "0x1111111111111111111111111111111111111111";
    const w2 = "0x2222222222222222222222222222222222222222";
    const messages = asArray(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo(w1), makeWalletInfo(w2)],
      getBalance: async (a?: string) => {
        if (a?.startsWith("0x1111")) throw new Error("balance rpc down");
        return makeBalance({ totalEquity: 200 });
      },
      getPositions: async () => [],
    }), []));

    expect(messages[0]).toContain("(failed: balance rpc down)");
    expect(messages[1]).toContain("$200.00");
  });

  it("truncates positions list at 30 entries with footer", async () => {
    const positions = Array.from({ length: 31 }, (_, i) =>
      makePosition({ symbol: `S${i}`, unrealizedPnl: 10, unrealizedPnlPct: 0.1 }),
    );
    const out = asString(await portfolioHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => positions,
    }), []));
    expect(out).toContain("S29");
    expect(out).not.toContain("S30 ");
    expect(out).toMatch(/\+1 more/);
  });
});
