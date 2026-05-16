import { describe, test, expect } from "bun:test";
import { toCexSymbol } from "../../../src/services/funding/symbol-mapping.js";

describe("toCexSymbol", () => {
  test("BTC + binance → BTCUSDT", () => {
    expect(toCexSymbol("BTC", "binance")).toBe("BTCUSDT");
  });

  test("BTC + bybit → BTCUSDT", () => {
    expect(toCexSymbol("BTC", "bybit")).toBe("BTCUSDT");
  });

  test("BTC + okx → BTC-USDT-SWAP", () => {
    expect(toCexSymbol("BTC", "okx")).toBe("BTC-USDT-SWAP");
  });

  test("kPEPE + binance → 1000PEPEUSDT", () => {
    expect(toCexSymbol("kPEPE", "binance")).toBe("1000PEPEUSDT");
  });

  test("kBONK + binance → 1000BONKUSDT", () => {
    expect(toCexSymbol("kBONK", "binance")).toBe("1000BONKUSDT");
  });

  // Tokens whose real first letter is K must not be treated as k-prefix memes.
  // The k-prefix guard runs on the untouched input so lowercase-k vs uppercase-K
  // is still distinguishable at that point.
  test("KAVA + binance → KAVAUSDT (not 1000AVAUSDT)", () => {
    expect(toCexSymbol("KAVA", "binance")).toBe("KAVAUSDT");
  });

  test("KSM + binance → KSMUSDT (not 1000SMUSDT)", () => {
    expect(toCexSymbol("KSM", "binance")).toBe("KSMUSDT");
  });

  test("KAS + binance → KASUSDT (not 1000ASUSDT)", () => {
    expect(toCexSymbol("KAS", "binance")).toBe("KASUSDT");
  });

  test("lowercase + whitespace '  btc  ' → BTCUSDT", () => {
    expect(toCexSymbol("  btc  ", "binance")).toBe("BTCUSDT");
  });

  test("empty string → null", () => {
    expect(toCexSymbol("", "binance")).toBeNull();
  });
});
