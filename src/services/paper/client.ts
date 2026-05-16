/**
 * Paper trading client — delegates market reads to real client,
 * routes writes to PaperEngine for local simulation.
 */

import type { ITradingClient } from "../interfaces/trading-client.js";
import type {
  Balance, Position, OpenOrder, Fill, Ticker, Kline, Orderbook, OrderRecord,
  PlaceOrderParams, PlaceOrderResult, CancelOrderResult, LeverageResult,
} from "../interfaces/trading-types.js";
import { PaperEngine } from "./engine.js";
import type { PaperConfig } from "../../config/schema.js";

export class PaperTradingClient implements ITradingClient {
  private marketClient: ITradingClient;
  private engine: PaperEngine;

  constructor(marketClient: ITradingClient, config: PaperConfig, dbPath?: string) {
    this.marketClient = marketClient;
    this.engine = new PaperEngine(marketClient, {
      initialBalance: config.initialBalance,
      takerFee: config.takerFee,
      makerFee: config.makerFee,
      priceMonitorInterval: config.priceMonitorInterval,
      dbPath,
    });
    this.engine.start();
  }

  get canWrite(): boolean { return true; }
  get address(): string { return "paper-default"; }

  connect(_config: { address: string; privateKey?: string; testnet?: boolean }): void {
    // No-op in paper mode — already connected
  }

  disconnect(): void {
    this.engine.reset();
  }

  resolveSymbol(symbol: string): string {
    return this.marketClient.resolveSymbol(symbol);
  }

  // Market reads — delegate to real client
  getTicker(symbol: string): Promise<Ticker> { return this.marketClient.getTicker(symbol); }
  getAllTickers(): Promise<Ticker[]> { return this.marketClient.getAllTickers(); }
  getOrderbook(symbol: string, depth?: number): Promise<Orderbook> { return this.marketClient.getOrderbook(symbol, depth); }
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]> { return this.marketClient.getKlines(symbol, interval, limit); }
  getFundingHistory(symbol: string, limit?: number): Promise<unknown[]> { return this.marketClient.getFundingHistory(symbol, limit); }
  ensureMeta(): Promise<void> { return this.marketClient.ensureMeta(); }
  getAssetIndex(symbol: string): Promise<number> { return this.marketClient.getAssetIndex(symbol); }
  getMaxLeverage(symbol: string): number | undefined { return this.marketClient.getMaxLeverage(symbol); }

  // Account reads — paper engine
  getBalance(_address?: string): Promise<Balance> { return this.engine.getBalance(); }
  getPositions(_address?: string): Promise<Position[]> { return this.engine.getPositions(); }
  getOpenOrders(_address?: string): Promise<OpenOrder[]> { return this.engine.getOpenOrders(); }
  getFills(_address?: string, limit?: number): Promise<Fill[]> { return this.engine.getFills(undefined, limit); }
  getFillsByTime(_address: string | undefined, startTime: number, endTime?: number): Promise<Fill[]> { return this.engine.getFillsByTime(undefined, startTime, endTime); }
  getHistoricalOrders(_address: string | undefined, startTime: number): Promise<OrderRecord[]> { return this.engine.getHistoricalOrders(undefined, startTime); }

  // Write operations — paper engine
  placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> { return this.engine.placeOrder(params); }
  cancelOrder(symbol: string, orderId: string): Promise<CancelOrderResult> { return this.engine.cancelOrder(symbol, orderId); }
  cancelAllOrders(symbol?: string): Promise<CancelOrderResult[]> { return this.engine.cancelAllOrders(symbol); }
  setLeverage(symbol: string, leverage: number, isCross?: boolean): Promise<LeverageResult> { return this.engine.setLeverage(symbol, leverage, isCross); }
  closePosition(symbol: string, slippagePct?: number): Promise<PlaceOrderResult> { return this.engine.closePosition(symbol, slippagePct); }
  partialClose(symbol: string, percentage: number, slippagePct?: number): Promise<PlaceOrderResult> { return this.engine.partialClose(symbol, percentage, slippagePct); }
  adjustMargin(symbol: string, amount: number): Promise<{ symbol: string; amount: number }> { return this.engine.adjustMargin(symbol, amount); }

  close(): void {
    this.engine.close();
  }

  reset(newBalance?: number): void {
    this.engine.reset(newBalance);
  }
}
