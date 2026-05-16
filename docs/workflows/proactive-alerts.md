# Proactive Alerts

Ghost tells you when something matters.

You're not asking Ghost a question. Ghost is watching your portfolio and only speaks up when there's something you need to know right now.

## How Proactive Works

Ghost runs an internal observer loop every 5 seconds. It watches:
- Your positions (price, distance to liquidation, PnL)
- Your open orders
- Price crossing your alert thresholds
- Large fills that just hit your account

When something changes structurally, Ghost's event-judge skill decides: is this worth notifying you about? Not every tick. Only when the answer is yes, Ghost sends a message to Telegram (or your configured channel) with a specific alert.

## The 4 Alert Types

**Position Auto-Closed (TP/SL Hit)**

Position closed because your Take-Profit or Stop-Loss order executed.

```
Position CLOSED: BTC LONG (1.0 BTC)
Closed: TP hit at $73,500
PnL: +$2,300 | Reason: TP
Time in trade: 2h 15m
```

**Liquidation Getting Close**

You're within 8% of liquidation price. Ghost alerts you so you can decide: add margin, reduce size, or accept the risk.

```
⚠ LIQUIDATION RISK: ETH LONG (5.0 contracts)
Distance to liquidation: 8% | Price: $3,240 | Liquidation: $2,981
Current PnL: -$820
Suggested actions: (1) Close 50% to double margin buffer; (2) Add $1,200 margin; 
(3) Hold and accept risk.
```

**Alert Price Crossed**

You set an alert ("notify me if BTC breaks $74k"), and it just broke.

```
ALERT HIT: BTC crosses above $74,000
Your position: LONG 0.5 BTC at avg $71,300
Current PnL: +$1,350
Next resistance: $75,200 (whale cluster)
```

**Large Fill Happened**

A big order you placed just executed. Sometimes useful to know you're partially filled, especially on larger-size trades.

```
FILL: ETH long partial fill
Amount: 3.5 of 5.0 contracts
Avg price: $3,238
Remaining: 1.5 contracts waiting
```

---

## Setting Alerts

Set a price alert via chat:

```
You: "alert BTC at 75000"
Ghost: Alert set. I'll notify you if BTC breaks $75,000. React fast.

You: "remove BTC alert"
Ghost: Done. No longer watching BTC price.
```

Or disable proactive entirely:

```
You: "proactive off"
Ghost: Proactive alerts paused. I'm still monitoring but won't send Telegram 
messages. TP/SL hits will still show on the web dashboard.
```

---

## Technical Details

Proactive runs in `src/observer/loop.ts`. Every 5 seconds:
1. It reads your positions, orders, and recent fills
2. It checks price cache against your alert rules
3. It diffes against the prior second to detect *structural changes* only
4. It invokes the event-judge skill to assess importance
5. On fire, it dispatches to Telegram (and optionally web)

The observer also handles a confirm-card gate: if you have a pending trade approval in the web app, it advances that baseline first before checking for new alerts. This prevents alert storms during trade setup.

Reference: [Channels &gt; Telegram](../channels/telegram.md) | [System Architecture &gt; Observer](../operations/observer.md)
