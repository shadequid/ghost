/**
 * Trading client interface — abstraction over live and paper trading.
 */

import type {
  Balance, Position, OpenOrder, Fill, Ticker, Kline, Orderbook,
  PlaceOrderParams, PlaceOrderResult, CancelOrderResult, LeverageResult,
  OrderRecord,
} from "./trading-types.js";

export interface ITradingClient {
  readonly canWrite: boolean;
  readonly address: string;

  connect(config: { address: string; privateKey?: string; testnet?: boolean }): void;
  disconnect(): void;
  resolveSymbol(symbol: string): string;

  getBalance(address?: string): Promise<Balance>;
  getPositions(address?: string): Promise<Position[]>;
  getOpenOrders(address?: string): Promise<OpenOrder[]>;
  getFills(address?: string, limit?: number): Promise<Fill[]>;
  getFillsByTime(address: string | undefined, startTime: number, endTime?: number): Promise<Fill[]>;

  /**
   * Fetch historical orders since `startTime`. Returns the mapped order list with
   * cloid + status preserved so callers can attribute Ghost-placed (cloid prefix
   * `0x67686f7374...`) versus external orders. Used by the proactive-advisor scan
   * for external-trade detection (replaces the WS-based ExternalTradeWatcher).
   *
   * @param startTime  Lower bound for order placement, ms since epoch.
   *
   * Returned in HL native order (newest first); empty array when no orders since
   * `startTime`. HL caps `historicalOrders` at the most recent 2000 records — caller
   * must use a window short enough to stay under the cap (proactive scan uses ≤ 3h,
   * well within).
   */
  getHistoricalOrders(address: string | undefined, startTime: number): Promise<OrderRecord[]>;

  getTicker(symbol: string): Promise<Ticker>;
  getAllTickers(): Promise<Ticker[]>;
  getOrderbook(symbol: string, depth?: number): Promise<Orderbook>;
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;
  getFundingHistory(symbol: string, limit?: number): Promise<unknown[]>;
  ensureMeta(): Promise<void>;
  getAssetIndex(symbol: string): Promise<number>;
  /** Max leverage for a symbol (undefined when meta not loaded or asset unknown). */
  getMaxLeverage(symbol: string): number | undefined;

  placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult>;
  cancelOrder(symbol: string, orderId: string): Promise<CancelOrderResult>;
  cancelAllOrders(symbol?: string): Promise<CancelOrderResult[]>;
  setLeverage(symbol: string, leverage: number, isCross?: boolean): Promise<LeverageResult>;
  closePosition(symbol: string, slippagePct?: number): Promise<PlaceOrderResult>;
  partialClose(symbol: string, percentage: number, slippagePct?: number): Promise<PlaceOrderResult>;
  adjustMargin(symbol: string, amount: number): Promise<{ symbol: string; amount: number }>;
}
