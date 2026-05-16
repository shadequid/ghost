# Tools Reference

Ghost exposes **56 tools**: 9 generic (file I/O, web, cron, memory) and 47 trading-specific. All trading tools use `ghost_` prefix. Parameters use TypeBox schemas; responses truncate at 16 KB and wrapped in `Result<T, E>` type.

## Master Tool Index

| Tool Name | Category | Class | Confirm? | Purpose | Source |
|-----------|----------|-------|----------|---------|--------|
| **Generic** | | | | | |
| `read_file` | Generic | R | No | Read file by line range; render images as base64 | src/tools/read-file.ts:20-45 |
| `write_file` | Generic | W | No | Create file + parent directories atomically | src/tools/write-file.ts:15-50 |
| `edit_file` | Generic | W | No | Find-replace with whitespace tolerance | src/tools/edit-file.ts:20-90 |
| `list_dir` | Generic | R | No | Recursive directory walk; caps at 200 entries | src/tools/list-dir.ts |
| `exec` | Generic | R/W | No | Shell execution; denies rm -rf, reboot, dd; 60s timeout | src/tools/exec.ts:40-110 |
| `web_search` | Generic | R | No | Brave API or DuckDuckGo; converts HTML to text | src/tools/web-search.ts |
| `web_fetch` | Generic | R | No | HTTP GET; SSRF-safe; validates each redirect | src/tools/web-fetch.ts |
| `cron` | Generic | Meta | No | Add/list/remove scheduled jobs; self-call protection | src/tools/cron.ts:50-120 |
| `save_memory` | Generic | Memory | No | Append HISTORY.md + update MEMORY.md | src/tools/save-memory.ts:15-60 |
| **Account** | | | | | |
| `ghost_connect_wallet` | Account | W | No | Connect Hyperliquid wallet (read+write) | src/tools/trading/account.ts:38-73 |
| `ghost_get_balance` | Account | R | No | Query equity, available margin, unrealized PnL | src/tools/trading/account.ts:75-96 |
| `ghost_get_positions` | Account | R | No | List open positions with entry, mark, leverage | src/tools/trading/account.ts:98-140 |
| `ghost_get_orders` | Account | R | No | List all open pending orders | src/tools/trading/account.ts:142-170 |
| `ghost_disconnect_wallet` | Account | W | No | Remove cached wallet credentials | src/tools/trading/account.ts:172-190 |
| `ghost_list_wallets` | Account | R | No | Show all saved wallets with status | src/tools/trading/account.ts:192-210 |
| `ghost_set_default_wallet` | Account | W | No | Select which wallet to use by default | src/tools/trading/account.ts:212-225 |
| **Orders** | | | | | |
| `ghost_place_order` | Orders | W | **Yes** | Market or limit order | src/tools/trading/orders.ts:40-67 |
| `ghost_cancel_order` | Orders | W | **Yes** | Cancel specific pending orders by ID | src/tools/trading/orders.ts:86-122 |
| `ghost_cancel_all_orders` | Orders | W | **Yes** | Sweep all pending orders (one symbol or all) | src/tools/trading/orders.ts:124-150 |
| `ghost_emergency_close` | Orders | W | **Yes** | Market close of position(s) immediately | src/tools/trading/orders.ts:152-176 |
| `ghost_set_leverage` | Orders | W | No | Set leverage + margin mode for symbol | src/tools/trading/orders.ts:69-84 |
| **Risk** | | | | | |
| `ghost_set_sl_tp` | Risk | W | **Yes** | Set stop-loss and/or take-profit on existing position | src/tools/trading/risk.ts:42-73 |
| `ghost_bracket_order` | Risk | W | **Yes** | Place entry + SL + TP atomically | src/tools/trading/risk.ts:75-104 |
| `ghost_partial_close` | Risk | W | **Yes** | Close N% or fixed size of position | src/tools/trading/risk.ts:106-130 |
| `ghost_adjust_margin` | Risk | W | **Yes** | Add/withdraw margin for isolated position | src/tools/trading/risk.ts:132-159 |
| **Market** | | | | | |
| `ghost_get_price` | Market | R | No | Current mark price, 24h change, volume, OI, funding | src/tools/trading/market.ts:16-43 |
| `ghost_get_funding_rates` | Market | R | No | Current + historical funding rates (hourly) | src/tools/trading/market.ts:45-68 |
| `ghost_get_orderbook` | Market | R | No | L2 orderbook snapshot with imbalance analysis | src/tools/trading/market.ts:70-93 |
| `ghost_get_klines` | Market | R | No | OHLCV candlestick data for charting/TA | src/tools/trading/market.ts:96-120 |
| **Intelligence** | | | | | |
| `ghost_market_overview` | Intel | R | No | Fear & Greed, market cap, TVL, trending, stablecoins | src/tools/trading/intel.ts:41-50 |
| `ghost_pre_trade_check` | Intel | R | No | Risk classifier on proposed trade | src/tools/trading/intel.ts:52-75 |
| `ghost_session_info` | Intel | R | No | Current session context, user timezone, idle time | src/tools/trading/intel-session.ts:10-40 |
| `ghost_chat_history` | Intel | R | No | Retrieve past assistant messages from session | src/tools/trading/chat-history.ts:5-30 |
| `ghost_cross_exchange_funding` | Intel | R | No | Funding rates across Hyperliquid vs Bybit vs Dydx | src/tools/trading/intel-funding.ts:10-50 |
| `ghost_liquidation_map` | Intel | R | No | Aggregated liquidation levels (cluster heatmap) | src/tools/trading/intel-liquidation.ts:20-65 |
| `ghost_timing_risk` | Intel | R | No | Session correlation, volatility regimes, momentum | src/tools/trading/intel-timing.ts:15-50 |
| `ghost_get_whale_activity` | Intel | R | No | Top traders' recent fills (wallet tracking) | src/tools/trading/intel-whale.ts:10-50 |
| `ghost_morning_briefing` | Intel | R | No | Cron-scheduled daily summary (when available) | src/tools/trading/intel-briefing.ts:5-40 |
| **History** | | | | | |
| `ghost_get_trade_history` | History | R | No | Closed trades with entry/exit, PnL, fees | src/tools/trading/history.ts:11-75 |
| `ghost_get_recent_orders` | History | R | No | Most recent executed orders (fills) with timestamps | src/tools/trading/recent-orders.ts:10-45 |
| **Watchlist** | | | | | |
| `ghost_watchlist_add` | Watchlist | W | No | Add symbol with optional notes | src/tools/trading/advanced.ts:52-68 |
| `ghost_watchlist_remove` | Watchlist | W | No | Remove symbol from watch | src/tools/trading/advanced.ts:69-85 |
| `ghost_watchlist_list` | Watchlist | R | No | List all watched symbols with current price + 24h change | src/tools/trading/advanced.ts:87-114 |
| `ghost_alert_set` | Watchlist | W | No | Set one-shot price-target alert | src/tools/trading/advanced.ts:116-170 |
| `ghost_alert_list` | Watchlist | R | No | List all active alerts with distance to target | src/tools/trading/advanced.ts:172-195 |
| `ghost_alert_remove` | Watchlist | W | No | Delete alert by ID | src/tools/trading/advanced.ts:197-210 |
| `ghost_alert_history` | Watchlist | R | No | View fired alerts (last 7 days) | src/tools/trading/advanced.ts:212-245 |
| `ghost_check_alerts` | Watchlist | R | No | Manually trigger alert scan (normally auto-run) | src/tools/trading/advanced.ts:247-265 |
| **Technical** | | | | | |
| `ghost_get_indicators` | Technical | R | No | Multi-indicator TA suite (EMA, RSI, MACD, Ichimoku, BB, ATR) | src/tools/trading/technical.ts:35-110 |
| `ghost_get_levels` | Technical | R | No | Automatic support/resistance detection (SR, pivots, Fib) | src/tools/trading/technical.ts:112-170 |
| **News** | | | | | |
| `ghost_news_sources` | News | R | No | List configured news sources | src/tools/trading/news.ts:5-35 |
| `ghost_news_search` | News | R | No | Search news by keyword or symbol across sources | src/tools/trading/news.ts:37-80 |
| `ghost_news_discover_rss` | News | R | No | Auto-discover RSS feeds for symbol (experimental) | src/tools/trading/news-discover.ts:10-50 |
| `ghost_news_add_source` | News | W | No | Add custom RSS feed to news aggregator | src/tools/trading/news-discover.ts:52-80 |
| `ghost_tweets_search` | News | R | No | Search tweets about symbol or topic | src/tools/trading/tweets.ts:5-50 |
| `ghost_x_follow` | News | W | No | Follow X account (for future notifications) | src/tools/trading/x-follows.ts:5-35 |

## Confirmation Policy

**8 tools require orchestrator-level user confirmation** before execution (src/services/confirm-policy.ts:31-40):

```typescript
// src/services/confirm-policy.ts:31-40
export const CONFIRMABLE_TOOLS: ReadonlySet<string> = new Set([
  "ghost_place_order",
  "ghost_cancel_order",
  "ghost_cancel_all_orders",
  "ghost_emergency_close",
  "ghost_set_sl_tp",
  "ghost_bracket_order",
  "ghost_partial_close",
  "ghost_adjust_margin",
]);
```

Confirm cards are generated deterministically by `describeConfirm()` in the same file. Agent never authors confirmation copy; content is mechanically derived from tool parameters.

### Sample Confirm Card: `ghost_place_order`

**Parameters:** `symbol="BTC"`, `side="buy"`, `size=0.5`, `leverage=5`

**Generated confirm card:**
- Title: `"Place market order: Long 0.5 BTC?"`
- Bullets: `["Side: Long 5x"]`

## How to Add a Tool

Minimal example: `ghost_hello` (factory pattern, 30 lines)

```typescript
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import { textResult, errorResult } from "../../helpers/result.js";

/**
 * Factory function: returns array of tools.
 * Services injected as factory params; no singletons.
 */
export function createHelloTools(): AnyAgentTool[] {
  return [
    {
      name: "ghost_hello",
      label: "Say Hello",
      description: "Greet the user with a personalized message.",
      parameters: Type.Object({
        name: Type.String({ description: "Name to greet" }),
      }),
      async execute(_toolCallId, params) {
        try {
          return textResult(`Hello, ${params.name}!`);
        } catch (e: unknown) {
          return errorResult(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];
}
```

**To integrate:**
1. Create module under `src/tools/trading/{category}.ts`
2. Export factory function returning `AnyAgentTool[]`
3. Import factory in `src/tools/trading/index.ts`
4. Call factory in `createAllTradingTools()` and spread result into registry
5. If write operation: add tool name to `CONFIRMABLE_TOOLS` in `src/services/confirm-policy.ts` and implement a `describeXyz` function

## Background Tool Execution

`TaskAgent` (background job orchestrator) runs with `bypassConfirm=true`, skipping the orchestrator confirm gate. This allows background loops (e.g., trailing-stop updates, cron jobs) to execute write operations without user approval.

**Security note:** Confirm gate is a UX affordance, not a security boundary. High-risk operations (place_order, emergency_close) should validate state server-side regardless of confirm gate state.

**Safe for background:** All read operations + low-risk writes (add to watchlist, set alerts, adjust watchlist notes). Avoid: place_order, cancel_all_orders, emergency_close from background without explicit async confirmation mechanism.
