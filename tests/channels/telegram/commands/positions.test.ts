import { describe, it, expect } from "bun:test";
import { positionsHandler } from "../../../../src/channels/telegram/commands/positions.js";
import { makeCtx, makeWalletInfo, makePosition } from "./helpers.js";

function asString(reply: string | string[]): string {
  if (typeof reply !== "string") throw new Error("expected single-string reply");
  return reply;
}

function asArray(reply: string | string[]): string[] {
  if (!Array.isArray(reply)) throw new Error("expected string[] reply");
  return reply;
}

describe("/positions handler", () => {
  it("replies with no-wallet message when none are connected", async () => {
    const out = asString(await positionsHandler(makeCtx(), []));
    expect(out).toBe("No wallet connected. Use the agent to connect one.");
  });

  it("renders detailed bullet block per position for a single wallet", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [
        makePosition({
          symbol: "BTC", side: "long", leverage: 5, marginMode: "cross",
          size: 0.5, entryPrice: 50_000, markPrice: 51_000, liquidationPrice: 30_000,
          unrealizedPnl: 184.20, unrealizedPnlPct: 1.62, margin: 5_000,
        }),
      ],
    }), []));

    expect(out).toContain("**Positions (1)**");
    expect(out).not.toContain("Wallet 0x");

    expect(out).toContain("**BTC** · Long 5x · cross");
    expect(out).not.toContain("🟢");
    // Indented `‐ Label: value` rows — same convention as /portfolio
    expect(out).toContain("   ‐ Size: 0.5");
    expect(out).toContain("   ‐ Entry: $50,000.00");
    expect(out).toContain("   ‐ Mark: $51,000.00");
    expect(out).not.toContain("Entry / Mark");
    expect(out).not.toContain("• Size");
    expect(out).not.toContain("   - Size"); // ASCII hyphen would get rewritten
    expect(out).toContain("   ‐ PnL: +$184.20 (+1.62%)");
    expect(out).toContain("   ‐ Liq: $30,000.00");
    expect(out).toContain("   ‐ Margin: $5,000.00");
  });

  it("renders Short for short positions with signed negative PnL (no direction icon)", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [
        makePosition({ symbol: "ETH", side: "short", marginMode: "isolated", unrealizedPnl: -42.5, unrealizedPnlPct: -1.7 }),
      ],
    }), []));
    expect(out).toContain("**ETH** · Short 5x · isolated");
    expect(out).not.toContain("🔴");
    expect(out).toContain("   ‐ PnL: -$42.50 (-1.70%)");
  });

  it("renders em-dash when liquidation price is null", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [makePosition({ liquidationPrice: null })],
    }), []));
    expect(out).toContain("   ‐ Liq: —");
  });

  it("shows 'No open positions.' when wallet has none", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [],
    }), []));
    expect(out).toContain("**Positions (0)**");
    expect(out).toContain("No open positions.");
  });

  it("filters by symbol when arg is provided", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [
        makePosition({ symbol: "BTC" }),
        makePosition({ symbol: "ETH" }),
      ],
    }), ["BTC"]));
    expect(out).toContain("**BTC**");
    expect(out).not.toContain("**ETH**");
    expect(out).toContain("**Positions (1)**");
  });

  it("upcases the symbol filter arg", async () => {
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => [makePosition({ symbol: "BTC" })],
    }), ["btc"]));
    expect(out).toContain("**BTC**");
  });

  it("returns usage hint for too many args", async () => {
    const out = asString(await positionsHandler(makeCtx(), ["BTC", "ETH"]));
    expect(out.toLowerCase()).toContain("usage");
  });

  it("returns one message per wallet for multi-wallet (string[])", async () => {
    const w1 = "0x1111111111111111111111111111111111111111";
    const w2 = "0x2222222222222222222222222222222222222222";
    const positions = new Map([
      [w1, [makePosition({ symbol: "BTC" })]],
      [w2, [makePosition({ symbol: "ETH", side: "short", unrealizedPnl: -50, unrealizedPnlPct: -2 })]],
    ]);
    const messages = asArray(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo(w1), makeWalletInfo(w2)],
      getPositions: async (a?: string) => positions.get(a ?? "") ?? [],
    }), []));

    expect(messages.length).toBe(2);
    expect(messages[0]).toContain("0x1111...1111");
    expect(messages[1]).toContain("0x2222...2222");
    expect(messages[0]).toContain("**BTC**");
    expect(messages[1]).toContain("**ETH**");
  });

  it("isolates per-wallet failures across messages", async () => {
    const w1 = "0x1111111111111111111111111111111111111111";
    const w2 = "0x2222222222222222222222222222222222222222";
    const messages = asArray(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo(w1), makeWalletInfo(w2)],
      getPositions: async (a?: string) => {
        if (a?.startsWith("0x1111")) throw new Error("rpc down");
        return [makePosition({ symbol: "ETH" })];
      },
    }), []));
    expect(messages[0]).toContain("(failed: rpc down)");
    expect(messages[1]).toContain("**ETH**");
  });

  it("truncates positions list at 30 entries with footer", async () => {
    const positions = Array.from({ length: 31 }, (_, i) =>
      makePosition({ symbol: `S${i}`, unrealizedPnl: 10, unrealizedPnlPct: 0.1 }),
    );
    const out = asString(await positionsHandler(makeCtx({
      wallets: [makeWalletInfo("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
      getPositions: async () => positions,
    }), []));
    expect(out).toContain("**S29**");
    expect(out).not.toContain("**S30**");
    expect(out).toMatch(/\+1 more/);
  });
});
