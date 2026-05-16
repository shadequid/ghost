# Why Companion, Not Dashboard or Bot?

Ghost is fundamentally different from the tools traders have used before. Understanding the distinction shapes how you interact with it.

## Three Products, One Problem

| Feature | Dashboard | Trading Bot | Ghost (Companion) |
|---------|-----------|-------------|-------------------|
| **Check portfolio** | Native app/browser | ✗ | Web + Telegram |
| **Execute trades** | Manual clicks | Auto (hard rules) | Manual + approval gates |
| **Before you trade** | Nothing | Nothing | Asks clarifying questions |
| **During trading** | Nothing | Nothing | Warns about emotions, risk |
| **After you trade** | Profit/loss | Backtest stats | Remembers context, learns preferences |
| **Remembers your style** | No | No | Yes (long-term memory) |

## Why Companion?

### 1. Pre-Trade Advisory

Most platforms wait for you to place an order, then let it rip. Ghost stops and asks:
- What's the thesis for this trade? (forcing you to articulate, not chase)
- Does this fit your risk model? (comparing to your historical behavior)
- What are the failure conditions? (SL and TP, not guesses)

A companion doesn't let you trade on impulse. A dashboard gives you a form. A bot executes before you can change your mind.

### 2. Emotion Awareness

Ghost watches for behavioral patterns:
- **FOMO** — You just lost. Now you're trying to recover with 3x leverage. Ghost notices and warns.
- **Overconfidence** — You've won 5 in a row. Ghost suggests holding some dry powder.
- **Analysis paralysis** — You've been watching the chart for 30 mins without entering. Ghost asks if you're uncertain.

Dashboards don't model emotions. Bots don't care. A companion remembers that you said "never revenge trade" and holds you to it.

### 3. Decision Retention

Every decision you make stays in Ghost's memory:
- You said: "I don't trade pumps, they always rug."
- You ask about DOGE pumping tomorrow.
- Ghost reminds: "You said pumps rug. Is today different?"

No other tool remembers this conversation. You have to enforce discipline alone.

### 4. Paper Trading First

Ghost starts you in paper mode (10k simulated USDC). Trade risk-free for days or weeks to build confidence. When you're ready, you pair your real wallet — Ghost already knows your patterns.

Dashboards force you live immediately. Bots have no paper mode. A companion says "practice first."

## Where Companions Break Down

- **Speed**: A companion asks questions. A bot executes in milliseconds. If you need to scalp 100 trades/day, Ghost adds latency.
- **Backtesting**: Ghost doesn't backtest strategies across years of history. It observes your live decisions and learns.
- **Coded rules**: Bots let you specify "if RSI > 70, sell." Ghost argues, then decides — sometimes you'll want to override.
- **Offline execution**: Bots run 24/7. Ghost needs your engagement. If you're asleep, Ghost watches but doesn't auto-execute (by default).

**Bottom line**: Ghost is built for traders who want a second opinion. If you want a program that trades while you sleep, use a bot.
