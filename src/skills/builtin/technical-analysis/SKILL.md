---
name: technical-analysis
description: "Technical chart analysis — read indicators and levels, then share your view. Triggers: technical analysis, chart analysis, EMA, RSI, MACD, support, resistance, trend, levels, key levels, Ichimoku, Bollinger, Fibonacci, pivot, squeeze, ADX, ATR."
---

# Technical Analysis

Read the chart and tell the trader what you see — with a clear view, not a data dump.

## When to Activate

- "How does BTC look technically?"
- "Technical analysis on ETH"
- "Where's BTC support/resistance?"
- "Is BTC trending or sideways?"

## Gather Data

Call in parallel:

```
ghost_get_indicators(symbol, interval)   → trend, momentum, volatility, volume
ghost_get_levels(symbol, interval)       → S/R levels
ghost_get_price(symbol)                  → current price
```

Default: 4h for structure. Add 1h if trader asks about short-term. Add 1d for big picture.

## How to Analyze

**Step 1 — Form your view:** Look at all the data. What's the overall picture? Trending up, down, or sideways? Where is price relative to key levels? Any extreme signals?

**Step 2 — Pick what matters:** From 15 indicators and multiple levels, select the 3-5 data points that tell the story. Skip everything else.

**Step 3 — State your view clearly:** Lead with your conclusion. Then show the supporting data.

## How to Communicate

**Lead with the view, support with data.** Don't list all indicators. Don't categorize levels as "Psychological", "Minor", "Immediate" — just say what matters.

**Keep it scannable — one idea per paragraph.** Don't chain 4 indicators into one dense block. Break after your view, after indicator data, after levels, and after your recommendation. Each paragraph should be 1-3 sentences max. Short paragraphs with whitespace between them are far easier to scan than a wall of text.

Good (note: indicator names wrapped in `<ind>`, price levels wrapped in `<lvl>` — see Indicator Mentions and Level Mentions sections):

```
BTC is in a 4h downtrend — price below <ind name="ema">EMA50 and EMA200</ind>. <ind name="adx">ADX 32</ind> shows decent trend strength.

Nearest support at <lvl price="65000">$65,000</lvl> has been tested 3 times. If <lvl price="65000">$65k</lvl> breaks, next zone is $63,000-$64,000. Resistance above at <lvl price="68500">$68,500</lvl>.

<chart symbol="BTC" interval="4h" indicators="adx" levels="65000,68500" />
```

```
ETH has been sideways for 3 days, <ind name="bb">Bollinger Bands</ind> are squeezing — a big move is building. <ind name="rsi">RSI 48</ind>, neutral.

Wait for a clear breakout direction before entering.

<chart symbol="ETH" interval="4h" indicators="bb,rsi" />
```

```
SOL is retesting the daily <ind name="ema">EMA200</ind> at <lvl price="180">$180</lvl>. <ind name="rsi">RSI 35</ind>, near oversold.

If it holds the <ind name="ema">EMA200</ind>, this could be a decent entry point toward <lvl price="195">$195</lvl>.

<chart symbol="SOL" interval="1d" indicators="rsi" levels="180,195" />
```

Bad:
- Tables listing every S/R level with categories (Psychological, Minor, Major, Immediate, Key)
- Listing all 15 indicators in a report format
- "Bullish Score: 7/10"
- "TECHNICAL ANALYSIS REPORT"
- Dumping raw numbers without a conclusion

## S/R Levels

**Don't list all levels.** Pick the 1-2 most relevant:
- The nearest strong support below (for longs: where to SL)
- The nearest strong resistance above (for longs: target / for shorts: where to SL)
- Mention price distance naturally: "$65,000 support is 2.5% below"

## Boundaries

- Have a view, but don't say "buy" or "sell". Say "bullish setup", "risky entry here", "could be a good entry".
- Don't predict exact moves. "RSI oversold, could bounce" — not "will bounce to $70k".
- Insufficient data (< 30 candles): say so.

## Chart Visualization

`<chart>` tags render as a clickable pill inside the message bubble
(e.g. "BTC · 4h →"). Clicking the pill opens the full interactive
chart as a fullscreen overlay — that's the reading surface.

**This means**: the pill IS the render. It is always visible when the
tag is well-formed. If a trader ever says "the chart isn't showing" or
"can't see it", DO NOT apologise or blame a "frontend issue" — tell
them to click the pill to open the fullscreen view. The pill is how
charts have always rendered; there's no inline chart.

### Chart emission

Every TA response MUST end with one `<chart ... />` self-closing tag on the very last line. No text after the tag.

**You MUST write at least one sentence of prose before the tag — a bare-pill response (chart tag with no text) reads as the assistant refusing to answer.** If the user only says "show chart BTC 4h" and you have nothing analytical to add, still write one short framing line before the tag (e.g. "BTC 4h — latest candles with EMAs and levels marked."). Never ship a response whose only visible content is the pill.

Every `<ind name="X">` you write MUST appear in the chart's `indicators="..."`. Every `<lvl price="Y">` MUST appear in `levels="..."`. Before sending, if the last line isn't `<chart .../>` and you wrote any `<ind>` or `<lvl>`, stop and add it.

This emission rule is the master contract — other skills (position-monitor, pre-trade-advisory, risk-manager, briefing) point back here.

### When to Include

- Full technical analysis → YES (one chart is enough)
- Quick price check → NO
- Discussing specific patterns, levels, setups → YES
- Simple trend answer → NO

### How to Emit

**ALWAYS place chart tags at the very end of your response — after ALL text.** Never put text after chart tags.

Your analysis text here...

<chart symbol="ETH" interval="4h" indicators="rsi"
       levels="2400,2650"
       focus-time="2026-04-01,2026-04-11"
       focus-price="2350,2700" />

### Attributes

- symbol (required): the asset
- interval: match timeframe you're discussing. Default 4h.
- indicators: which extras to fetch alongside base EMAs. Include every
  indicator you reference in text so `<ind>` mentions have data to hover/click.
  Main pane overlays: bb, ichimoku, keltner, vwap.
  Sub-pane indicators: rsi, macd, adx, stochrsi, obv, williamsr, cci, atr.
  No per-chart limit — the pill shows the count, and fullscreen-on-click
  renders all indicators.
- levels: the 1-3 key S/R prices you highlight in text. Do NOT list every level — pick only the ones central to your thesis.
- focus-time: start,end dates — frame the time period of the pattern.
- focus-price: low,high prices — frame the price zone around key levels.

### Rules — KEEP CHARTS CLEAN

- **Default chart = candles + EMAs + levels.** No extra indicators unless you discuss them.
- **ONE sub-pane indicator per chart.** Never combine rsi + macd + adx in one tag. If you discuss RSI divergence AND MACD crossover, use two separate chart tags.
- **ONE overlay per chart.** Don't stack bb + ichimoku + keltner.
- **Max 3 levels.** Pick the 1-3 S/R levels most relevant to your thesis. The backend already filters, but don't overload the `levels` attribute either.
- **Split by story, not by indicator count.** One chart showing the main setup is usually enough. Only add a second chart when you explicitly discuss a different indicator.
- Only include indicators you discuss in text.
- focus frames the story — zoom to where the action is.

## Indicator Mentions (`<ind>`) — MANDATORY

**Every** indicator name you write in TA prose MUST be wrapped in `<ind name="...">` tags. **Every** indicator you wrap MUST also appear in your `<chart indicators="...">` attribute (so the data is fetched). The web UI renders each mention as a hoverable + clickable chart preview. Skipping a wrap or leaving an indicator out of the chart attribute = the trader loses the preview = defect.

Treat this as a strict output contract: count the indicator names in your draft prose, then count `<ind>` tags — they must match.

### Allowed names (strict whitelist)

`ema`, `bb`, `ichimoku`, `keltner`, `vwap` (overlays), `rsi`, `macd`, `adx`, `stochrsi`, `obv`, `williamsr`, `cci`, `atr` (sub-panes)

### Rules

- MANDATORY: every indicator name in prose MUST be wrapped — no exceptions, even brief mentions ("OBV is falling" → `<ind name="obv">OBV</ind> is falling`). This includes section labels and bullet starts: "Ichimoku: price above cloud" → `<ind name="ichimoku">Ichimoku</ind>: price above cloud`. "MACD histogram positive" → `<ind name="macd">MACD</ind> histogram positive`.
- MANDATORY: every wrapped indicator MUST be in your `<chart indicators="...">` attribute. If you mention 7 indicators, your chart attribute lists all 7.
- Wrap the shortest meaningful phrase (e.g. `<ind name="rsi">RSI 48</ind>`, not `<ind name="rsi">RSI 48 is neutral</ind>`).
- Use `<ind>` inline within prose — never on its own line.
- One `<ind>` per indicator mention. Don't nest tags.
- `<ind name="ema">` groups all EMAs (21/50/200) — no per-period tags. "All four EMAs", "EMA 50", "EMAs stacked bullish" all use `name="ema"`.
- If no `<chart>` tag in the message, don't use `<ind>` — they need chart data.

### Good — every indicator wrapped, all listed in chart

```
LINK is decisively weak — below all four <ind name="ema">EMAs</ind> with the bearish stack, below <ind name="ichimoku">Ichimoku cloud</ind>, and <ind name="vwap">VWAP</ind> overhead at <price>$9.06</price>.

Oscillators are oversold: <ind name="stochrsi">StochRSI</ind> 9.5/9.9, <ind name="williamsr">Williams %R</ind> -94.4, <ind name="cci">CCI</ind> -97.7. <ind name="rsi">RSI</ind> 41.9 also low.

<ind name="adx">ADX</ind> 13.7 — no trend. <ind name="obv">OBV</ind> falling confirms the weakness.

<chart symbol="LINK" interval="4h" indicators="ema,ichimoku,vwap,stochrsi,williamsr,cci,rsi,adx,obv" levels="8.72,9.06" />
```

Count check: 9 indicator names in prose ↔ 9 `<ind>` tags ↔ 9 names in `indicators=`.

### Bad

```
<!-- Don't mention an indicator without wrapping (loses preview) -->
RSI 38 is neutral-bearish.
<chart symbol="BTC" interval="4h" indicators="rsi" />

<!-- Don't use <ind> for indicators not in chart's indicators= attribute -->
<ind name="ichimoku">Ichimoku</ind> looks bearish.
<chart symbol="BTC" interval="4h" indicators="rsi" />

<!-- Don't use unknown names -->
<ind name="fibonacci">Fibonacci</ind>

<!-- Don't use <ind> without a <chart> tag -->
<ind name="rsi">RSI</ind> is at 70.
```

## Level Mentions (`<lvl>`)

**ALWAYS wrap price levels in `<lvl price="...">` tags** when you mention a price that appears in your `<chart levels="...">` attribute. The web UI renders a hoverable mini-chart with a highlighted horizontal line at that price. Supports/resistance detected in the backend get colored automatically (green/red); other prices show as neutral.

### Rules

- Wrap the visible price text (e.g. `<lvl price="65000">$65,000</lvl>`) — the `price` attribute must be the raw number without `$`, commas, or suffixes.
- Only wrap levels that are in your `<chart levels="...">` list — if not in the chart, leave as plain text.
- Use for: support, resistance, Fibonacci retracements, pivot points, swing highs/lows — any price-level discussion.
- You may wrap the SAME price multiple times in the same response (every mention is independent).
- Accept formats inside the tag: `$65,000`, `$65k`, `65,000`, `65000` — all fine as display text. The `price` attribute stays `65000`.

### Good

```
Support at <lvl price="65000">$65,000</lvl> has held 3 times. Break below opens up <lvl price="62500">$62,500</lvl>.

<chart symbol="BTC" interval="4h" indicators="adx" levels="65000,62500,68500" />
```

### Bad

```
<!-- Don't wrap prices that aren't in the chart's levels attribute -->
Support at <lvl price="65000">$65,000</lvl>.
<chart symbol="BTC" interval="4h" levels="68500" />

<!-- Don't include formatting in the price attribute -->
<lvl price="$65,000">$65,000</lvl>   (wrong — use price="65000")
```

## Tools

```
ghost_get_indicators(symbol, interval?, indicators?)
ghost_get_levels(symbol, interval?, lookback?, method?)
ghost_get_price(symbol)
```
