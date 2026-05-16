# Services Reference

Ghost's runtime comprises services organized across trading, intelligence, technical analysis, OS integration, and LLM provider layers. Services are stateless, wired via explicit DI in `src/runtime.ts`. No module-level singletons.

## Central Services

| Service | Purpose |
|---------|---------|
| **ITradingClient** | Abstraction over live/paper trading. All tools depend on it. |
| **HyperliquidClient** | Live trading via @nktkas/hyperliquid SDK. |
| **PaperTradingClient** | Routes reads to live, writes to PaperEngine. |
| **AlertRulesService** | User price targets; publishes to EventBus. |
| **ObserverLoop** | Proactive scanner (fills, liquidations, price targets). |
| **NewsService** | Multi-source aggregation + dedup + TTL tiers. |

For the full per-service file list and LOC, see `src/services/` directly. Files exceed 300 LOC where the underlying SDK or domain forces it.

---

## ITradingClient Contract

Core interface for all trading operations. Implemented by `HyperliquidClient` (live) and `PaperTradingClient` (paper).

| Method | Signature | Purpose |
|--------|-----------|---------|
| `connect(config)` | `(config: AccountConfig) => void` | Wire account. No-op in paper. |
| `getTicker(symbol)` | `(symbol: string) => Promise<Ticker>` | Bid/ask/mark/oracle + 24h stats. |
| `getKlines(symbol, interval, limit?)` | `(symbol: string, interval: string, limit?: number) => Promise<Kline[]>` | OHLCV. Intervals: "1m", "5m", "15m", "1h", "4h", "1d". |
| `getBalance(address?)` | `(address?: string) => Promise<Balance>` | Equity, available, used margin, unrealized PnL. |
| `getPositions(address?)` | `(address?: string) => Promise<Position[]>` | Symbol, side, size, entry, liquidation, leverage. |
| `getOpenOrders(address?)` | `(address?: string) => Promise<OpenOrder[]>` | Resting orders with price, filled, timestamp. |
| `getFills(address?, limit?)` | `(address?: string, limit?: number) => Promise<Fill[]>` | Trade history with dir and liquidation flag. |
| `placeOrder(params)` | `(params: OrderParams) => Promise<PlaceOrderResult>` | Market/limit/stop. Returns cloid if Ghost-stamped. |
| `cancelOrder(symbol, orderId)` | `(symbol: string, orderId: string) => Promise<void>` | Cancel resting order. |
| `setLeverage(symbol, leverage, isCross?)` | `(symbol: string, leverage: number, isCross?: boolean) => Promise<void>` | Set leverage (cross or isolated). |

**Error modes:** Timeout → logged, null/empty for reads; write throws. Invalid symbol → null or exchange error.

---

## Live vs. Paper Trading

| Aspect | Live | Paper |
|--------|------|-------|
| **Market Reads** | Real HL REST | Delegate to live |
| **Account State** | HL REST | SQLite engine state |
| **Writes** | Send to HL (real cost) | Simulate in engine |
| **Cloid Generation** | SDK returns; Ghost stamps | Deterministic SHA-256 |
| **Margin Tiers** | HL enforces | `PaperMarginTiers` validates locally |
| **Reset** | N/A | `engine.reset(balance?)` wipes all |

Routing: `src/runtime.ts` — `config.paper.enabled ? PaperTradingClient(...) : hyperliquidClient`.
