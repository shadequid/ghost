import { describe, test, expect } from "bun:test";
import { getMaxLeverage, getMaintenanceMarginRate, validateLeverage } from "../../src/services/paper/margin-tiers.js";

describe("margin-tiers", () => {
  test("BTC max leverage is 40x", () => {
    expect(getMaxLeverage("BTC")).toBe(40);
  });

  test("ETH max leverage is 25x", () => {
    expect(getMaxLeverage("ETH")).toBe(25);
  });

  test("SOL max leverage is 20x", () => {
    expect(getMaxLeverage("SOL")).toBe(20);
  });

  test("mid-cap assets (DOGE, LINK, ARB) have 10x max", () => {
    expect(getMaxLeverage("DOGE")).toBe(10);
    expect(getMaxLeverage("LINK")).toBe(10);
    expect(getMaxLeverage("ARB")).toBe(10);
  });

  test("unknown asset defaults to 5x", () => {
    expect(getMaxLeverage("UNKNOWNCOIN")).toBe(5);
  });

  test("symbol lookup is case-insensitive", () => {
    expect(getMaxLeverage("btc")).toBe(40);
    expect(getMaxLeverage("Eth")).toBe(25);
  });

  test("maintenance margin rate for BTC is 0.5%", () => {
    expect(getMaintenanceMarginRate("BTC")).toBe(0.005);
  });

  test("maintenance margin rate for unknown defaults to 5%", () => {
    expect(getMaintenanceMarginRate("UNKNOWN")).toBe(0.05);
  });

  test("validateLeverage passes at max", () => {
    expect(() => validateLeverage("BTC", 40)).not.toThrow();
  });

  test("validateLeverage passes below max", () => {
    expect(() => validateLeverage("BTC", 10)).not.toThrow();
  });

  test("validateLeverage throws above max", () => {
    expect(() => validateLeverage("BTC", 50)).toThrow(/exceeds max 40x/i);
  });

  test("validateLeverage throws for unknown asset above 5x", () => {
    expect(() => validateLeverage("OBSCURE", 10)).toThrow(/exceeds max 5x/i);
  });
});
