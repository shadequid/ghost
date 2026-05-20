/**
 * Paper trading engine — persistent SQLite in workspace dir.
 * Simulates order fills using live market data.
 * State (balances, positions, orders, fills) persists across daemon restarts.
 */

import { Database } from "bun:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { getWorkspaceDir } from "../../config/paths.js";
import { join } from "node:path";
import type {
  Balance, Position, OpenOrder, Fill, Ticker, OrderRecord,
  PlaceOrderParams, PlaceOrderResult, CancelOrderResult, LeverageResult,
} from "../interfaces/trading-types.js";
import { validateLeverage, getMaintenanceMarginRate } from "./margin-tiers.js";
import { generateGhostCloid, GHOST_CLOID_PREFIX } from "../../helpers/cloid.js";

/**
 * Stable Ghost-prefix cloid derived from `orderId` via SHA-256.
 *
 * Idempotent across reads — calling `getHistoricalOrders` twice on the same
 * paper order returns the same cloid. Matches live-client behavior where the
 * cloid is persisted at place time. Total length matches HL constraint
 * (`0x` + 32 hex chars).
 */
function deterministicGhostCloid(orderId: string): string {
  const hash = createHash("sha256").update(orderId).digest("hex");
  return `${GHOST_CLOID_PREFIX}${hash.slice(0, 22)}`;
}

export interface MarketDataSource {
  getTicker(symbol: string): Promise<Ticker>;
  resolveSymbol(symbol: string): string;
}

export interface PaperEngineConfig {
  initialBalance: number;
  takerFee: number;
  makerFee: number;
  priceMonitorInterval: number;
  /** Override DB path. Defaults to ~/.ghost/workspace/paper-trading.db. Use ":memory:" for tests. */
  dbPath?: string;
}

export class PaperEngine {
  private db: Database;
  private marketClient: MarketDataSource;
  private config: PaperEngineConfig;
  private scanInterval: Timer | null = null;
  private fundingInterval: Timer | null = null;

  constructor(
    marketClient: MarketDataSource,
    config: PaperEngineConfig,
  ) {
    this.marketClient = marketClient;
    this.config = config;
    const dbPath = config.dbPath ?? join(getWorkspaceDir(), "paper-trading.db");
    this.db = new Database(dbPath);
    this.initSchema();
    // Only initialize account if DB is fresh — preserves balance across restarts
    const existing = this.db.query("SELECT 1 FROM paper_accounts WHERE id = 'default'").get();
    if (!existing) {
      this.initAccount(config.initialBalance);
    }
  }

  // ─── Schema ───

  private initSchema(): void {
    this.db.run("PRAGMA journal_mode = WAL");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_accounts (
        id              TEXT PRIMARY KEY DEFAULT 'default',
        initial_balance REAL NOT NULL,
        balance         REAL NOT NULL,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_positions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol        TEXT NOT NULL UNIQUE,
        side          TEXT NOT NULL CHECK (side IN ('long', 'short')),
        size          REAL NOT NULL,
        entry_price   REAL NOT NULL,
        leverage      REAL NOT NULL DEFAULT 1,
        margin_mode   TEXT NOT NULL DEFAULT 'cross',
        margin        REAL NOT NULL,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_orders (
        id            TEXT PRIMARY KEY,
        symbol        TEXT NOT NULL,
        side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        order_type    TEXT NOT NULL,
        price         REAL NOT NULL,
        size          REAL NOT NULL,
        reduce_only   INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_fills (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol        TEXT NOT NULL,
        side          TEXT NOT NULL,
        price         REAL NOT NULL,
        size          REAL NOT NULL,
        fee           REAL NOT NULL DEFAULT 0,
        realized_pnl  REAL NOT NULL DEFAULT 0,
        order_id      TEXT,
        filled_at     INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_leverage (
        symbol        TEXT PRIMARY KEY,
        leverage      REAL NOT NULL DEFAULT 1,
        is_cross      INTEGER NOT NULL DEFAULT 1
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS paper_funding_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol        TEXT NOT NULL,
        side          TEXT NOT NULL,
        size          REAL NOT NULL,
        oracle_price  REAL NOT NULL,
        funding_rate  REAL NOT NULL,
        payment       REAL NOT NULL,
        applied_at    INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  }

  private initAccount(balance: number): void {
    this.db.run(
      "INSERT OR REPLACE INTO paper_accounts (id, initial_balance, balance) VALUES ('default', ?, ?)",
      [balance, balance],
    );
  }

  // ─── Account reads ───

  async getBalance(): Promise<Balance> {
    const row = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
    const balance = row.balance;

    const positions = await this.getPositions();
    const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const usedMargin = positions.reduce((sum, p) => sum + p.margin, 0);

    return {
      totalEquity: balance + usedMargin + unrealizedPnl,
      availableBalance: Math.max(0, balance - usedMargin),
      usedMargin,
      unrealizedPnl,
    };
  }

  async getPositions(): Promise<Position[]> {
    const rows = this.db.query("SELECT * FROM paper_positions").all() as Array<{
      symbol: string; side: string; size: number; entry_price: number;
      leverage: number; margin_mode: string; margin: number;
    }>;

    const positions: Position[] = [];
    for (const row of rows) {
      let markPrice: number;
      try {
        const ticker = await this.marketClient.getTicker(row.symbol);
        markPrice = ticker.markPrice;
      } catch {
        markPrice = row.entry_price;
      }

      const pnl = row.side === "long"
        ? (markPrice - row.entry_price) * row.size
        : (row.entry_price - markPrice) * row.size;
      const pnlPct = row.margin > 0 ? (pnl / row.margin) * 100 : 0;

      // Liquidation price: entry +/- (margin - maintenanceMargin) / size
      const mmr = getMaintenanceMarginRate(row.symbol);
      const maintenanceMargin = row.size * row.entry_price * mmr;
      const buffer = (row.margin - maintenanceMargin) / row.size;
      const liquidationPrice = row.side === "long"
        ? Math.max(0, row.entry_price - buffer)
        : row.entry_price + buffer;

      positions.push({
        symbol: row.symbol,
        side: row.side as "long" | "short",
        size: row.size,
        entryPrice: row.entry_price,
        markPrice,
        liquidationPrice,
        unrealizedPnl: pnl,
        unrealizedPnlPct: pnlPct,
        leverage: row.leverage,
        marginMode: row.margin_mode === "isolated" ? "isolated" : "cross",
        margin: row.margin,
      });
    }
    return positions;
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const rows = this.db.query("SELECT * FROM paper_orders ORDER BY created_at DESC").all() as Array<{
      id: string; symbol: string; side: string; order_type: string;
      price: number; size: number; reduce_only: number; created_at: number;
    }>;

    return rows.map((r) => ({
      orderId: r.id,
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      orderType: r.order_type,
      price: r.price,
      triggerPrice: r.order_type.includes("stop") || r.order_type.includes("take_profit") ? r.price : null,
      size: r.size,
      filled: 0,
      reduceOnly: r.reduce_only === 1,
      timestamp: r.created_at * 1000,
    }));
  }

  async getFills(_address?: string, limit = 20): Promise<Fill[]> {
    const rows = this.db.query(
      "SELECT * FROM paper_fills ORDER BY filled_at DESC LIMIT ?",
    ).all(limit) as Array<{
      id: number; symbol: string; side: string; price: number; size: number;
      fee: number; realized_pnl: number; order_id: string | null; filled_at: number;
    }>;

    return rows.map((r) => this.rowToFill(r));
  }

  async getFillsByTime(_address: string | undefined, startTime: number, endTime?: number): Promise<Fill[]> {
    // DB stores filled_at in seconds; API speaks ms.
    // Both bounds use Math.floor for a uniform inclusive-of-second semantics.
    const startSec = Math.floor(startTime / 1000);
    const endSec = Math.floor((endTime ?? Date.now()) / 1000);
    const rows = this.db.query(
      "SELECT * FROM paper_fills WHERE filled_at >= ? AND filled_at <= ? ORDER BY filled_at DESC",
    ).all(startSec, endSec) as Array<{
      id: number; symbol: string; side: string; price: number; size: number;
      fee: number; realized_pnl: number; order_id: string | null; filled_at: number;
    }>;
    return rows.map((r) => this.rowToFill(r));
  }

  /**
   * Return paper orders placed since `startTime` (ms).
   *
   * Paper orders are Ghost-placed by definition — there is no live HL stream
   * delivering external trades to paper mode. The cloid stamped at place-time
   * is not persisted to `paper_orders`, so we derive a stable
   * Ghost-prefix cloid from `r.id` via SHA-256 at read time. The result is
   * idempotent — two reads of the same order return the same cloid,
   * matching live-client behavior where cloid is persisted. Downstream
   * attribution (`isGhostCloid` / orders tool) labels paper orders correctly
   * as Ghost-placed rather than `external`.
   *
   * Note: `paper_orders` only contains currently-resting orders; rows are
   * deleted on fill, cancel, liquidation, or full close. So this returns
   * the subset of "still-open since startTime" — not full history. This is
   * acceptable for proactive advisor flows that consume `recent orders` to
   * detect Ghost-placed protections.
   */
  async getHistoricalOrders(_address: string | undefined, startTime: number): Promise<OrderRecord[]> {
    // DB stores created_at in seconds; API speaks ms. Mirrors getFillsByTime.
    const startSec = Math.floor(startTime / 1000);
    const rows = this.db.query(
      `SELECT id, symbol, side, order_type, price, size, reduce_only, created_at
       FROM paper_orders WHERE created_at >= ? ORDER BY created_at DESC`,
    ).all(startSec) as Array<{
      id: string; symbol: string; side: string; order_type: string;
      price: number; size: number; reduce_only: number; created_at: number;
    }>;

    return rows.map((r) => ({
      oid: r.id,
      cloid: deterministicGhostCloid(r.id),
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      price: r.price,
      // paper_orders stores trigger price in `price` for stop/TP — mirror getOpenOrders.
      triggerPrice: r.order_type.includes("stop") || r.order_type.includes("take_profit") ? r.price : null,
      size: r.size,
      reduceOnly: r.reduce_only === 1,
      // Only resting orders are stored in paper_orders.
      status: "open" as const,
      timestamp: r.created_at * 1000,
    }));
  }

  private rowToFill(r: {
    id: number; symbol: string; side: string; price: number; size: number;
    fee: number; realized_pnl: number; filled_at: number;
  }): Fill {
    return {
      tradeId: String(r.id),
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      price: r.price,
      size: r.size,
      fee: r.fee,
      feeToken: "USDC",
      realizedPnl: r.realized_pnl,
      timestamp: r.filled_at * 1000,
    };
  }

  // ─── Write operations ───

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const resolved = this.marketClient.resolveSymbol(params.symbol);
    // Paper orders cannot originate outside Ghost (no live HL stream), so the
    // cloid is stamped for API parity only — it is NOT persisted to paper_orders
    // or paper_fills. The external-trade detector is event-driven on live
    // HL streams; paper symmetry is YAGNI until paper gains an external-trade
    // scenario.
    const cloid = generateGhostCloid();

    if (params.orderType === "market") {
      const result = await this.executeMarketOrder(resolved, params);
      return { ...result, cloid };
    }

    // Limit / stop / TP orders -> queue as pending
    const orderId = randomUUID();
    if (!params.price) throw new Error(`${params.orderType} order requires price`);

    this.db.run(
      "INSERT INTO paper_orders (id, symbol, side, order_type, price, size, reduce_only) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [orderId, resolved, params.side, params.orderType, params.price, params.size, params.reduceOnly ? 1 : 0],
    );

    return {
      symbol: resolved,
      side: params.side,
      orderType: params.orderType,
      status: params.orderType === "limit" ? "resting" : "waitingForTrigger",
      orderId,
      price: String(params.price),
      size: String(params.size),
      cloid,
    };
  }

  private async executeMarketOrder(symbol: string, params: PlaceOrderParams, isMaker = false): Promise<PlaceOrderResult> {
    const ticker = await this.marketClient.getTicker(symbol);
    // Paper trading fills at midPrice with zero slippage by design — the
    // simulation models the user's strategy, not the venue's microstructure.
    // `isMaker` still drives fee selection below; `params.slippagePct` is
    // accepted on the wire for parity with the live client but ignored.
    const fillPrice = ticker.midPrice;

    // All SQL writes in a transaction for consistency
    return this.db.transaction(() => {
      const existing = this.db.query("SELECT * FROM paper_positions WHERE symbol = ?").get(symbol) as {
        side: string; size: number; entry_price: number; margin: number; leverage: number;
      } | null;

      const isBuy = params.side === "buy";
      const newSide = isBuy ? "long" : "short";

      // Reduce-only validation: can only reduce/close existing position
      if (params.reduceOnly) {
        if (!existing) throw new Error("Reduce-only order rejected: no open position");
        if (existing.side === newSide) throw new Error("Reduce-only order rejected: cannot increase position");
        // Clamp size to position size — no flips allowed
        params = { ...params, size: Math.min(params.size, existing.size) };
      }

      const feeRate = isMaker ? this.config.makerFee : this.config.takerFee;
      const notional = params.size * fillPrice;
      const fee = notional * feeRate;
      const leverage = this.getLeverage(symbol);
      const margin = notional / leverage;

      if (existing) {
        if (existing.side === newSide) {
          const totalSize = existing.size + params.size;
          const avgEntry = (existing.entry_price * existing.size + fillPrice * params.size) / totalSize;
          const totalMargin = existing.margin + margin;

          const account = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
          if (account.balance < margin + fee) {
            throw new Error(`Insufficient balance. Available: ${account.balance.toFixed(2)} USDC, Required: ${(margin + fee).toFixed(2)} USDC`);
          }

          this.db.run("UPDATE paper_positions SET size = ?, entry_price = ?, margin = ? WHERE symbol = ?", [totalSize, avgEntry, totalMargin, symbol]);
          this.db.run("UPDATE paper_accounts SET balance = balance - ? WHERE id = 'default'", [margin + fee]);
        } else {
          if (params.size >= existing.size) {
            const pnl = existing.side === "long"
              ? (fillPrice - existing.entry_price) * existing.size
              : (existing.entry_price - fillPrice) * existing.size;

            this.db.run("DELETE FROM paper_positions WHERE symbol = ?", [symbol]);
            this.db.run("DELETE FROM paper_orders WHERE symbol = ?", [symbol]);
            this.db.run("UPDATE paper_accounts SET balance = balance + ? + ? - ? WHERE id = 'default'", [existing.margin, pnl, fee]);
            this.recordFill(symbol, params.side, fillPrice, existing.size, fee, pnl);

            const remaining = params.size - existing.size;
            if (remaining > 0) {
              const flipNotional = remaining * fillPrice;
              const flipMargin = flipNotional / leverage;
              const flipFee = flipNotional * feeRate;

              const account = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
              if (account.balance < flipMargin + flipFee) {
                throw new Error(`Insufficient balance for flip. Available: ${account.balance.toFixed(2)} USDC`);
              }

              this.db.run("INSERT INTO paper_positions (symbol, side, size, entry_price, leverage, margin) VALUES (?, ?, ?, ?, ?, ?)", [symbol, newSide, remaining, fillPrice, leverage, flipMargin]);
              this.db.run("UPDATE paper_accounts SET balance = balance - ? - ? WHERE id = 'default'", [flipMargin, flipFee]);
              this.recordFill(symbol, params.side, fillPrice, remaining, flipFee, 0);
            }

            return {
              symbol, side: params.side, orderType: "market", status: "filled" as const,
              filledSize: String(params.size), avgFillPrice: String(fillPrice),
            };
          } else {
            const pnl = existing.side === "long"
              ? (fillPrice - existing.entry_price) * params.size
              : (existing.entry_price - fillPrice) * params.size;
            const marginReleased = existing.margin * (params.size / existing.size);

            this.db.run("UPDATE paper_positions SET size = ?, margin = ? WHERE symbol = ?", [existing.size - params.size, existing.margin - marginReleased, symbol]);
            this.db.run("UPDATE paper_accounts SET balance = balance + ? + ? - ? WHERE id = 'default'", [marginReleased, pnl, fee]);
            this.recordFill(symbol, params.side, fillPrice, params.size, fee, pnl);

            return {
              symbol, side: params.side, orderType: "market", status: "filled" as const,
              filledSize: String(params.size), avgFillPrice: String(fillPrice),
            };
          }
        }
      } else {
        const account = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
        if (account.balance < margin + fee) {
          throw new Error(`Insufficient balance. Available: ${account.balance.toFixed(2)} USDC, Required: ${(margin + fee).toFixed(2)} USDC`);
        }

        this.db.run("INSERT INTO paper_positions (symbol, side, size, entry_price, leverage, margin) VALUES (?, ?, ?, ?, ?, ?)", [symbol, newSide, params.size, fillPrice, leverage, margin]);
        this.db.run("UPDATE paper_accounts SET balance = balance - ? - ? WHERE id = 'default'", [margin, fee]);
      }

      this.recordFill(symbol, params.side, fillPrice, params.size, fee, 0);

      return {
        symbol, side: params.side, orderType: "market", status: "filled" as const,
        filledSize: String(params.size), avgFillPrice: String(fillPrice),
      };
    })();
  }

  async cancelOrder(symbol: string, orderId: string): Promise<CancelOrderResult> {
    const resolved = this.marketClient.resolveSymbol(symbol);
    const row = this.db.query("SELECT id FROM paper_orders WHERE id = ?").get(orderId);
    if (!row) throw new Error(`Order ${orderId} not found`);
    this.db.run("DELETE FROM paper_orders WHERE id = ?", [orderId]);
    return { symbol: resolved, orderId, status: "cancelled" };
  }

  async cancelAllOrders(symbol?: string): Promise<CancelOrderResult[]> {
    const orders = await this.getOpenOrders();
    const filtered = symbol
      ? orders.filter((o) => o.symbol === this.marketClient.resolveSymbol(symbol))
      : orders;
    for (const o of filtered) {
      this.db.run("DELETE FROM paper_orders WHERE id = ?", [o.orderId]);
    }
    return filtered.map((o) => ({ symbol: o.symbol, orderId: o.orderId, status: "cancelled" as const }));
  }

  async setLeverage(symbol: string, leverage: number, isCross = true): Promise<LeverageResult> {
    const resolved = this.marketClient.resolveSymbol(symbol);
    validateLeverage(resolved, leverage);

    // Hyperliquid: cannot switch margin mode while position is open
    const pos = this.db.query("SELECT side FROM paper_positions WHERE symbol = ?").get(resolved) as { side: string } | null;
    if (pos) {
      const current = this.db.query("SELECT is_cross FROM paper_leverage WHERE symbol = ?").get(resolved) as { is_cross: number } | null;
      const currentIsCross = current?.is_cross !== 0; // default cross
      if (currentIsCross !== isCross) {
        throw new Error(`Cannot switch margin mode while ${resolved} position is open. Close the position first.`);
      }
    }

    this.db.run(
      "INSERT OR REPLACE INTO paper_leverage (symbol, leverage, is_cross) VALUES (?, ?, ?)",
      [resolved, leverage, isCross ? 1 : 0],
    );
    return { symbol: resolved, leverage, marginMode: isCross ? "cross" : "isolated" };
  }

  async closePosition(symbol: string, slippagePct = 0.5): Promise<PlaceOrderResult> {
    const resolved = this.marketClient.resolveSymbol(symbol);
    const pos = this.db.query("SELECT * FROM paper_positions WHERE symbol = ?").get(resolved) as {
      side: string; size: number;
    } | null;
    if (!pos) throw new Error(`No open position for ${resolved}`);

    const result = await this.placeOrder({
      symbol: resolved,
      side: pos.side === "long" ? "sell" : "buy",
      size: pos.size,
      orderType: "market",
      reduceOnly: true,
      slippagePct,
    });

    // Cancel remaining SL/TP orders after full close
    await this.cancelAllOrders(resolved);

    return result;
  }

  async partialClose(symbol: string, percentage: number, slippagePct = 0.5): Promise<PlaceOrderResult> {
    const resolved = this.marketClient.resolveSymbol(symbol);
    const pos = this.db.query("SELECT * FROM paper_positions WHERE symbol = ?").get(resolved) as {
      side: string; size: number;
    } | null;
    if (!pos) throw new Error(`No open position for ${resolved}`);

    const closeSize = pos.size * (percentage / 100);
    const result = await this.placeOrder({
      symbol: resolved,
      side: pos.side === "long" ? "sell" : "buy",
      size: closeSize,
      orderType: "market",
      reduceOnly: true,
      slippagePct,
    });

    // If position is fully closed (100%), cancel remaining SL/TP orders
    if (percentage >= 100) {
      await this.cancelAllOrders(resolved);
    }

    return result;
  }

  async adjustMargin(symbol: string, amount: number): Promise<{ symbol: string; amount: number }> {
    const resolved = this.marketClient.resolveSymbol(symbol);
    const pos = this.db.query("SELECT * FROM paper_positions WHERE symbol = ?").get(resolved) as {
      margin: number;
    } | null;
    if (!pos) throw new Error(`No open position for ${resolved}`);
    if (amount > 0) {
      const account = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
      if (account.balance < amount) throw new Error(`Insufficient balance. Available: ${account.balance.toFixed(2)} USDC`);
    }
    if (amount < 0 && pos.margin + amount < 0) {
      throw new Error(`Cannot withdraw more margin than available (${pos.margin.toFixed(2)} USDC)`);
    }
    this.db.run("UPDATE paper_positions SET margin = margin + ? WHERE symbol = ?", [amount, resolved]);
    this.db.run("UPDATE paper_accounts SET balance = balance - ? WHERE id = 'default'", [amount]);
    return { symbol: resolved, amount };
  }

  // ─── Price monitor (pending order triggers) ───

  start(): void {
    this.scanInterval = setInterval(() => {
      void this.checkPendingOrders();
      void this.checkLiquidation();
    }, this.config.priceMonitorInterval);

    // Apply funding every hour (3600s)
    const FUNDING_INTERVAL_MS = 3_600_000;
    this.fundingInterval = setInterval(() => void this.applyFunding(), FUNDING_INTERVAL_MS);
  }

  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.fundingInterval) {
      clearInterval(this.fundingInterval);
      this.fundingInterval = null;
    }
  }

  async checkPendingOrders(): Promise<void> {
    const orders = this.db.query("SELECT * FROM paper_orders").all() as Array<{
      id: string; symbol: string; side: string; order_type: string;
      price: number; size: number; reduce_only: number;
    }>;

    for (const order of orders) {
      try {
        const ticker = await this.marketClient.getTicker(order.symbol);
        const markPrice = ticker.markPrice;
        let shouldFill = false;

        switch (order.order_type) {
          case "limit":
            shouldFill = order.side === "buy"
              ? markPrice <= order.price
              : markPrice >= order.price;
            break;
          case "stop_market":
          case "stop_limit":
            shouldFill = order.side === "buy"
              ? markPrice >= order.price
              : markPrice <= order.price;
            break;
          case "take_profit":
          case "take_profit_limit":
            shouldFill = order.side === "buy"
              ? markPrice <= order.price
              : markPrice >= order.price;
            break;
        }

        if (shouldFill) {
          // Limit orders get maker fee; stop/TP orders get taker fee
          const isMaker = order.order_type === "limit";
          await this.executeMarketOrder(order.symbol, {
            symbol: order.symbol,
            side: order.side as "buy" | "sell",
            size: order.size,
            orderType: "market",
            reduceOnly: order.reduce_only === 1,
          }, isMaker);
          this.db.run("DELETE FROM paper_orders WHERE id = ?", [order.id]);
        }
      } catch {
        // Order stays pending — retry next cycle
      }
    }
  }

  /**
   * Apply hourly funding to all open positions using live rates.
   * Payment = size * oraclePrice * fundingRate
   * Positive rate: longs pay, shorts receive. Negative rate: opposite.
   */
  async applyFunding(): Promise<void> {
    const rows = this.db.query("SELECT * FROM paper_positions").all() as Array<{
      symbol: string; side: string; size: number; entry_price: number;
    }>;

    for (const row of rows) {
      try {
        const ticker = await this.marketClient.getTicker(row.symbol);
        const { oraclePrice, fundingRate } = ticker;

        // Payment from the perspective of the position holder
        // Positive rate: longs pay (negative payment), shorts receive (positive payment)
        const rawPayment = row.size * oraclePrice * fundingRate;
        const payment = row.side === "long" ? -rawPayment : rawPayment;

        this.db.run("UPDATE paper_accounts SET balance = balance + ? WHERE id = 'default'", [payment]);
        this.db.run(
          "INSERT INTO paper_funding_history (symbol, side, size, oracle_price, funding_rate, payment) VALUES (?, ?, ?, ?, ?, ?)",
          [row.symbol, row.side, row.size, oraclePrice, fundingRate, payment],
        );
      } catch {
        // Skip — retry next cycle
      }
    }
  }

  /** Auto-close positions when mark price reaches liquidation level. */
  async checkLiquidation(): Promise<void> {
    const rows = this.db.query("SELECT * FROM paper_positions").all() as Array<{
      symbol: string; side: string; size: number; entry_price: number;
      margin: number; leverage: number;
    }>;

    for (const row of rows) {
      try {
        const ticker = await this.marketClient.getTicker(row.symbol);
        const markPrice = ticker.markPrice;

        const mmr = getMaintenanceMarginRate(row.symbol);
        const maintenanceMargin = row.size * row.entry_price * mmr;
        const buffer = (row.margin - maintenanceMargin) / row.size;
        const liqPrice = row.side === "long"
          ? Math.max(0, row.entry_price - buffer)
          : row.entry_price + buffer;

        const isLiquidated = row.side === "long"
          ? markPrice <= liqPrice
          : markPrice >= liqPrice;

        if (isLiquidated) {
          // Close at mark price with full loss
          const pnl = row.side === "long"
            ? (markPrice - row.entry_price) * row.size
            : (row.entry_price - markPrice) * row.size;
          const closeSide = row.side === "long" ? "sell" : "buy";

          this.db.run("DELETE FROM paper_positions WHERE symbol = ?", [row.symbol]);
          // Return margin + PnL (PnL is negative at liquidation), ensure balance >= 0
          const balanceChange = Math.max(-this.getAccountBalance(), row.margin + pnl);
          this.db.run("UPDATE paper_accounts SET balance = balance + ? WHERE id = 'default'", [balanceChange]);
          this.recordFill(row.symbol, closeSide, markPrice, row.size, 0, pnl);

          // Cancel any related pending orders
          this.db.run("DELETE FROM paper_orders WHERE symbol = ?", [row.symbol]);
        }
      } catch {
        // Skip — retry next cycle
      }
    }
  }

  // ─── Helpers ───

  private getAccountBalance(): number {
    const row = this.db.query("SELECT balance FROM paper_accounts WHERE id = 'default'").get() as { balance: number };
    return row.balance;
  }

  private getLeverage(symbol: string): number {
    const row = this.db.query("SELECT leverage FROM paper_leverage WHERE symbol = ?").get(symbol) as { leverage: number } | null;
    return row?.leverage ?? 1;
  }

  private recordFill(symbol: string, side: string, price: number, size: number, fee: number, realizedPnl: number): void {
    this.db.run(
      "INSERT INTO paper_fills (symbol, side, price, size, fee, realized_pnl) VALUES (?, ?, ?, ?, ?, ?)",
      [symbol, side, price, size, fee, realizedPnl],
    );
  }

  reset(newBalance?: number): void {
    const balance = newBalance ?? this.config.initialBalance;
    this.db.run("DELETE FROM paper_positions");
    this.db.run("DELETE FROM paper_orders");
    this.db.run("DELETE FROM paper_fills");
    this.db.run("DELETE FROM paper_leverage");
    this.db.run("DELETE FROM paper_funding_history");
    this.db.run("UPDATE paper_accounts SET balance = ?, initial_balance = ? WHERE id = 'default'", [balance, balance]);
  }

  close(): void {
    this.stop();
    this.db.close();
  }
}
