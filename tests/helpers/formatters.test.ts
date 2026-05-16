import { describe, test, expect } from "bun:test";
import {
  formatUsd,
  formatPct,
  formatPnl,
  formatLeverage,
  formatSide,
  formatPosition,
  formatPositions,
  formatBalance,
  formatOrder,
} from "../../src/helpers/formatters.js";

describe("formatUsd", () => {
  test("millions", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50M");
    expect(formatUsd(-2_300_000)).toBe("$-2.30M");
  });

  test("thousands with commas", () => {
    expect(formatUsd(1234.56)).toBe("$1,234.56");
    expect(formatUsd(67000)).toBe("$67,000.00");
  });

  test("normal values", () => {
    expect(formatUsd(42.5)).toBe("$42.50");
    expect(formatUsd(1)).toBe("$1.00");
  });

  test("small values", () => {
    expect(formatUsd(0.0012)).toBe("$0.0012");
    expect(formatUsd(0.0001)).toBe("$0.0001");
  });

  test("very small values", () => {
    expect(formatUsd(0.00005)).toBe("$0.000050");
  });

  test("zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  test("negative values", () => {
    expect(formatUsd(-500)).toBe("$-500.00");
    expect(formatUsd(-0.005)).toBe("$-0.0050");
  });
});

describe("formatPct", () => {
  test("positive", () => {
    expect(formatPct(5.5)).toBe("+5.50%");
  });

  test("negative", () => {
    expect(formatPct(-3.2)).toBe("-3.20%");
  });

  test("zero has no sign", () => {
    expect(formatPct(0)).toBe("0.00%");
  });
});

describe("formatPnl", () => {
  test("positive", () => {
    expect(formatPnl(500)).toBe("+$500.00");
  });

  test("negative", () => {
    expect(formatPnl(-200)).toBe("$-200.00");
  });

  test("zero has no plus sign", () => {
    expect(formatPnl(0)).toBe("$0.00");
  });
});

describe("formatLeverage", () => {
  test("formats with x suffix", () => {
    expect(formatLeverage(5)).toBe("5x");
    expect(formatLeverage(10)).toBe("10x");
  });
});

describe("formatSide", () => {
  test("uppercases", () => {
    expect(formatSide("long")).toBe("LONG");
    expect(formatSide("short")).toBe("SHORT");
    expect(formatSide("buy")).toBe("BUY");
  });
});

describe("formatPosition", () => {
  test("basic position", () => {
    const result = formatPosition({
      symbol: "BTC",
      side: "long",
      size: 0.5,
      entryPrice: 67000,
      markPrice: 68200,
      leverage: 5,
      unrealizedPnl: 600,
    });
    expect(result).toContain("BTC LONG 5x");
    expect(result).toContain("Size: 0.5");
    expect(result).toContain("+$600.00");
  });

  test("includes liquidation price when present", () => {
    const result = formatPosition({
      symbol: "ETH",
      side: "short",
      size: 2,
      entryPrice: 3400,
      markPrice: 3450,
      leverage: 10,
      unrealizedPnl: -100,
      liquidationPrice: 3700,
    });
    expect(result).toContain("Liq: $3,700.00");
  });

  test("omits liquidation when null", () => {
    const result = formatPosition({
      symbol: "SOL",
      side: "long",
      size: 10,
      entryPrice: 150,
      markPrice: 155,
      leverage: 3,
      unrealizedPnl: 50,
      liquidationPrice: null,
    });
    expect(result).not.toContain("Liq:");
  });
});

describe("formatPositions", () => {
  test("empty returns no positions message", () => {
    expect(formatPositions([])).toBe("No open positions.");
  });

  test("formats multiple positions with total PnL", () => {
    const result = formatPositions([
      { symbol: "BTC", side: "long", size: 0.5, entryPrice: 67000, markPrice: 68000, leverage: 5, unrealizedPnl: 500 },
      { symbol: "ETH", side: "short", size: 2, entryPrice: 3400, markPrice: 3350, leverage: 10, unrealizedPnl: 100 },
    ]);
    expect(result).toContain("2 open position(s)");
    expect(result).toContain("+$600.00");
  });
});

describe("formatBalance", () => {
  test("formats portfolio summary", () => {
    const result = formatBalance({
      equity: 25420,
      availableMargin: 18200,
      totalMarginUsed: 7220,
      unrealizedPnl: 680,
      positionCount: 3,
    });
    expect(result).toContain("Portfolio Summary");
    expect(result).toContain("$25,420.00");
    expect(result).toContain("+$680.00");
    expect(result).toContain("Positions:   3");
  });
});

describe("formatOrder", () => {
  test("limit order", () => {
    const result = formatOrder({
      symbol: "BTC",
      side: "buy",
      type: "limit",
      size: 0.5,
      price: 65000,
    });
    expect(result).toContain("BTC BUY limit 0.5 @ $65,000.00");
  });

  test("market order (no price)", () => {
    const result = formatOrder({
      symbol: "ETH",
      side: "sell",
      type: "market",
      size: 2,
    });
    expect(result).toContain("@ Market");
  });

  test("stop order with trigger", () => {
    const result = formatOrder({
      symbol: "SOL",
      side: "sell",
      type: "stop_market",
      size: 10,
      triggerPrice: 140,
    });
    expect(result).toContain("(trigger: $140.00)");
  });
});
