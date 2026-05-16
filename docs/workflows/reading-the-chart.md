# Reading the Chart

Ask Ghost what the chart says.

When you want a quick technical read on a chart without pulling up TradingView, you ask Ghost. Ghost fetches the klines, runs indicators, identifies key levels, and gives you an opinion with an interactive chart.

## A Chart Request

```
You: "show me BTC 4h"

Ghost: BTC 4h Technical Analysis
═══════════════════════════════════════════════════════════════════════════

TREND
  Price: $73,100 | 24h: +3.2%
  EMA 9:  $72,980 — price above
  EMA 21: $72,100 — price above
  EMA 50: $71,200 — price above (clear uptrend)
  EMA 200: $69,500 — well above (long-term bullish)
  ADX: 28.5 — strong trending (not overbought yet)

MOMENTUM
  RSI: 62.1 — neutral (not overbought, not oversold)
  MACD: Positive, histogram positive (momentum accelerating)
  StochRSI K: 58 / D: 54 — rising, not extreme

VOLATILITY
  ATR: $685 (0.94% of price) — moderate
  Bollinger Bands: Upper $73.8k | Mid $72.9k | Lower $71.2k
  Squeeze: No — bands are expanding (breakout potential)

SUPPORT & RESISTANCE
  $73,200 — whale cluster, resistance from 4d MA
  $72,500 — intraday support (low of last 4h)
  $71,000 — psychological + historical support
  $74,100 — next resistance (whale cluster from yesterday)

CHART

[Interactive candlestick chart rendering: BTC 4h, last 50 candles, 
 overlays: EMA9, EMA21, EMA50, EMA200, RSI, MACD]
```

Ghost ran:
- **ghost_get_klines** — fetched last 50 4h candles for BTC
- **ghost_get_indicators** — computed EMA, RSI, MACD, ADX, Bollinger, ATR
- **ghost_get_levels** — identified key support/resistance levels from historical swings

The chart pill is interactive: click it on Telegram to open fullscreen; on web, it renders as a zoomable candlestick chart with all indicators overlaid.

---

## Tag Formatting in Chart Analysis

When Ghost mentions indicators or levels in prose, they're wrapped in tags for hover-preview:

- `<ind name="ema">EMA50</ind>` — hoverable indicator preview (just that indicator)
- `<ind name="rsi">RSI</ind>` — momentum indicator
- `<ind name="macd">MACD</ind>` — trend + momentum
- `<lvl price="73200">$73,200</lvl>` — horizontal line at that price on the chart preview

**Rule:** Every indicator name mentioned in TA prose MUST be wrapped in `<ind>` AND must appear in the chart's indicators list. No exceptions — skipping a wrap is a UX bug.

---

## What Ghost Analyzes

**Trend** — Are EMAs aligned? Price above or below each one?
**Momentum** — Is RSI climbing, topping, or at extremes?
**Volatility** — Are Bollinger Bands expanding (breakout) or squeezing (coil)?
**Volume** — Last candle volume vs. 20-candle average?
**Support & Resistance** — Swing highs/lows, Fibonacci levels, psychological marks?

## More Chart Options

```
You: "show me ETH daily"
Ghost: [renders ETH 1d chart]

You: "show me BTC 15m with volume"
Ghost: [adds on-balance volume indicator]

You: "what's the setup on SOL?"
Ghost: [auto-selects 1h for active trading, calls out setup entry/SL/TP]
```

---

## On Web vs. Telegram

**Telegram:** Chart renders as a clickable pill. Click → opens fullscreen TradingView-like view in browser.

**Web Dashboard:** Chart renders as a live, zoomable candlestick pane. Click indicators to show/hide. Pan and zoom with mouse.

Reference: [Concepts &gt; Technical Analysis](../get-started/asking-ghost.md) | [Channels &gt; Telegram](../channels/telegram.md)
