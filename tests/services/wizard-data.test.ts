import { describe, it, expect } from "bun:test";
import {
  composeOpenPositionWizard,
  type WizardCardData,
} from "../../src/services/wizard-data.js";

describe("WizardCardData", () => {
  it("open_position discriminator is type-safe", () => {
    const w: WizardCardData = {
      kind: "open_position",
      symbol: "BTC",
      side: "long",
      leverage: 10,
      size: 1,
      orderType: "limit",
      entryPrice: 62342,
      stopLoss: 79200,
      takeProfit: 79200,
    };
    expect(w.kind).toBe("open_position");
  });

  it("market order without entryPrice leaves entry undefined", () => {
    const w = composeOpenPositionWizard({
      symbol: "btc",
      side: "sell",
      size: 0.013,
      leverage: 5,
      orderType: "market",
      stopLoss: 77750,
      takeProfit: 74750,
    });
    expect(w).toBeDefined();
    expect(w!.entryPrice).toBeUndefined();
    expect(w!.stopLoss).toBe(77750);
    expect(w!.takeProfit).toBe(74750);
  });

  it("entryPrice = 0 literal is treated as missing", () => {
    const w = composeOpenPositionWizard({
      symbol: "BTC",
      side: "buy",
      size: 1,
      leverage: 10,
      orderType: "limit",
      entryPrice: 0,
    });
    expect(w!.entryPrice).toBeUndefined();
  });

  it("limit order surfaces tool-param entryPrice verbatim", () => {
    const w = composeOpenPositionWizard({
      symbol: "BTC",
      side: "buy",
      size: 1,
      leverage: 10,
      orderType: "limit",
      entryPrice: 60000,
      stopLoss: 58000,
      takeProfit: 64000,
    });
    expect(w).toBeDefined();
    expect(w!.entryPrice).toBe(60000);
    expect(w!.stopLoss).toBe(58000);
    expect(w!.takeProfit).toBe(64000);
  });

  it("normalises side aliases to long/short", () => {
    const longBuy = composeOpenPositionWizard({ symbol: "BTC", side: "buy", size: 1 });
    const shortSell = composeOpenPositionWizard({ symbol: "BTC", side: "sell", size: 1 });
    expect(longBuy!.side).toBe("long");
    expect(shortSell!.side).toBe("short");
  });

  it("generic discriminator accepts groups with rows", () => {
    const w: WizardCardData = {
      kind: "generic",
      groups: [
        { label: "Position", rows: [{ label: "Symbol", value: "BTC" }] },
        { rows: [{ label: "PnL", value: "+$120", tone: "reward" }] },
      ],
    };
    expect(w.kind).toBe("generic");
    expect(w.groups[0].rows[0].label).toBe("Symbol");
  });
});
