# Telegram

Ghost's Telegram bot lets you chat, check your portfolio, view positions, and approve trades right from your phone. No logging in to a dashboard—just message the bot.

## Setup

1. **Get a bot token:** Chat with [BotFather](https://t.me/botfather) on Telegram and create a new bot. Copy the token.

2. **Connect to Ghost:** Run the setup wizard:
   ```bash
   ghost onboard
   ```
   When asked, choose **Telegram** as your channel. Paste the bot token.

3. **Pair your account:** Message your bot with `/start`. Ghost will send you a pairing code. On the web dashboard, click the Telegram icon in the top bar to open the setup modal. The pending pairing request appears with the code—click **Approve** to accept it.

4. **Start chatting:** Send a message to your bot and Ghost will respond. Trade approvals use inline buttons (✅ / ❌) or you can reply `yes`/`no`.

## Commands

Available slash commands in Telegram:

| Command | What it does |
|---------|-------------|
| `/portfolio` | Show your wallet balance and net worth |
| `/positions` | List all open positions with P&L |
| `/news` | Latest market news and headlines |
| `/price <symbol>` | Get the current price of a coin (e.g., `/price ETH`) |
| `/alerts` | Show your active price alerts |

Any other message goes to the AI agent, which can chat, analyze charts, research, and draft trades.

## Approving Trades

When Ghost proposes a trade, you'll see an approval message with two buttons:
- **✅ Confirm** — Execute the trade
- **❌ Cancel** — Reject and discard it

You can also reply with `yes`, `y`, `confirm` (to approve) or `no`, `n`, `cancel` (to reject).

The approval card shows:
- Trade type (long/short entry, close, etc.)
- Symbol and size
- Entry/exit prices
- Estimated P&L

Approvals expire after 5 minutes if not answered.

## Telegram Limitations

Telegram is best for quick checks and approvals. Some features are web-only:

| Feature | Telegram | Web |
|---------|----------|-----|
| Chat & trade approval | ✓ | ✓ |
| Portfolio & positions | ✓ | ✓ |
| Market intelligence | ✓ | ✓ |
| Chart analysis | ✗ | ✓ |
| Memory & history | ✗ | ✓ |
| View chat logs | ✗ | ✓ |
| Scheduler (cron) | ✗ | ✓ |

For a full view of your trading history, charts, and memory, open the web dashboard.

## Privacy

Ghost only responds to the user IDs you've paired. The bot won't reply to unknown users or group chats unless they've been explicitly added as allowed devices in the web UI. Your bot token is never exposed or logged.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot doesn't respond | Check that the bot token is correct and the daemon is running (`ghost status`). |
| Pairing code expired | Run `/start` again to get a new code. |
| "Not authorized" on approval | The pairing request expired or was already approved. Open the Telegram setup modal (icon in top bar) and approve a fresh request, or try `/start` again. |
| Bot offline | Run `ghost daemon` to start the server. |
