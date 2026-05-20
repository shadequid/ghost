/**
 * Tool names classified as read-only (no side effects).
 *
 * Used in two places:
 *  - Security policy `enforceToolOperation` — in `read_only` autonomy mode,
 *    anything not in this set is treated as an "act" and blocked.
 *  - Background taskAgent allowlist (`ToolRegistry.taskAgentTools()`) — the
 *    Runner only exposes tools in this set (plus `save_memory` + `cron`) so
 *    news/judge/cron loops cannot trigger a write/exec confirm card.
 *
 * Keep this list authoritative — when adding a new read tool (e.g. a fresh
 * `ghost_get_*` query), add its name here.
 */
export const READ_TOOLS = new Set([
  // Generic
  "read_file",
  "list_dir",
  "web_fetch",
  "web_search",
  // Trading — account / state reads
  "ghost_chat_history",
  "ghost_get_trade_history",
  "ghost_get_balance",
  "ghost_get_positions",
  "ghost_get_orders",
  "ghost_list_wallets",
  "ghost_get_recent_orders",
  // Trading — market data
  "ghost_get_price",
  "ghost_get_funding_rates",
  "ghost_get_orderbook",
  "ghost_get_klines",
  "ghost_get_indicators",
  "ghost_get_levels",
  // Trading — intel / briefings
  "ghost_market_overview",
  "ghost_pre_trade_check",
  "ghost_morning_briefing",
  "ghost_session_info",
  "ghost_timing_risk",
  "ghost_cross_exchange_funding",
  "ghost_liquidation_map",
  "ghost_get_whale_activity",
  // Trading — social / news reads
  "ghost_tweets_search",
  "ghost_news_sources",
  "ghost_news_search",
  "ghost_news_discover_rss",
  // Trading — watchlist / alert reads
  "ghost_watchlist_list",
  "ghost_alert_list",
  "ghost_alert_history",
  "ghost_check_alerts",
]);
