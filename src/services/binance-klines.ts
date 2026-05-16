/**
 * Binance Futures klines fetcher — used as fallback when Hyperliquid API fails.
 * Public endpoint, no API key required.
 */

import type { Kline } from "./interfaces/trading-types";

const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1/klines";
const TIMEOUT_MS = 10_000;

/** Map HL-style symbol ("BTC") to Binance Futures format ("BTCUSDT"). */
function toBinanceSymbol(symbol: string): string {
  const clean = symbol.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/, "");
  return `${clean}USDT`;
}

/** Fetch klines from Binance Futures. Throws on failure. */
export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Kline[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL(BINANCE_FAPI);
    url.searchParams.set("symbol", toBinanceSymbol(symbol));
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance klines: ${res.status} ${text}`);
    }

    const data = (await res.json()) as unknown[][];
    return data.map((c) => ({
      openTime: Number(c[0]),
      open: parseFloat(c[1] as string),
      high: parseFloat(c[2] as string),
      low: parseFloat(c[3] as string),
      close: parseFloat(c[4] as string),
      volume: parseFloat(c[5] as string),
    }));
  } finally {
    clearTimeout(timer);
  }
}
