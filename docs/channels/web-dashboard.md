# Web Dashboard

Open Ghost at **http://localhost:15401**. The dashboard is one screen — a chat in the middle with the context you need on either side.

## Layout

```
┌───────────────────────────── Top strip ──────────────────────────┐
│  Ghost · model badge       notifications · Telegram · settings   │
├──────────────┬────────────────────────────────┬──────────────────┤
│  Portfolio   │                                │   Tweets         │
│              │           Chat                 │                  │
│  Watchlist   │   (messages, tool chips,       │   News           │
│              │    approval cards)             │                  │
│              │                                │                  │
└──────────────┴────────────────────────────────┴──────────────────┘
```

A chart pane slides in above the chat when you ask Ghost about a symbol — candlesticks plus the indicators and levels Ghost just computed, side-by-side with the conversation that produced them.

## Chat

The center of the screen. Messages stream in real time — you see Ghost typing as it thinks. Tool calls appear as inline chips with the tool name and arguments; click a chip to expand the full result. When Ghost wants to place, modify, or close a trade, an approval card drops into the conversation with **Confirm** and **Cancel** buttons — five-minute expiry, your call. Past sessions persist locally, so closing the tab doesn't lose anything.

The empty state suggests starter prompts based on whether a wallet is connected.

## Portfolio and Watchlist (left)

Your equity, available margin, and open positions with live P&L. If no wallet is connected, the panel walks you through connecting one.

Below it: your watchlist. Symbols you're tracking with mark price and 24h change, ready to drag into a chat ("how does HYPE look?") or expand for more.

## Tweets and News (right)

The right column is your incoming signal. Tweets pulled from accounts you follow on X (or your full following list, your choice). News headlines from the sources you've enabled, filtered to coins on your watchlist. Click a headline for the full article inline — you don't leave the dashboard to read context.

## Top strip

Always visible:
- **Notifications** — recent alerts and events.
- **Telegram** — pairs your bot. Click the icon, paste a token, message the bot, approve the pairing request. (Not in settings — the icon is the entry point.)
- **Settings menu** — provider and model status, log shortcut.

## Approvals everywhere

If the bot is paired, every trade approval card in chat also lands in your Telegram thread as inline buttons. First decision wins — confirm from your phone, the card on the dashboard updates, and the trade executes. Skipping out for lunch doesn't mean missing a fill.

## Network exposure

Ghost binds to `0.0.0.0:15401` by default — no in-app auth. Fine on a trusted home network. On a VPS or anything reachable from the internet, put a tunnel in front. See [network-exposure.md](../security/network-exposure.md) for Cloudflare Tunnel + Access, Tailscale, and ngrok OAuth recipes.
