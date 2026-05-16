# Channels Architecture

Channels are pluggable communication adapters. The dispatcher routes inbound messages to the agent and outbound messages to registered channels. Only Telegram is currently implemented.

## Channel Plugin Contract

All channels extend `BaseChannel<TConfig>` (src/channels/base.ts:19-56) and implement:

| Method | Signature | Purpose |
|--------|-----------|---------|
| `start()` | `async start(): Promise<void>` | Boot the channel (e.g., grammY polling) |
| `stop()` | `async stop(): Promise<void>` | Graceful shutdown |
| `send(msg)` | `async send(msg: OutboundMessage): Promise<void>` | Send a message to a chat |
| `sendDelta()` | `async sendDelta(chatId, delta, metadata?): Promise<void>` | Stream a text delta (optional) |

Channels declare streaming support via the `supportsStreaming` getter (src/channels/base.ts:49-52):
- Returns `true` only if `config.streaming === true` AND the channel overrides `sendDelta`.
- Non-streaming channels buffer agent responses and send them as complete messages.

**Activation:** Telegram is wired in `daemon/index.ts` only if `credentials._token` is set. Not exposed in `runtime.ts` to allow optional compile-time activation.

## Telegram Architecture

**Entry:** `src/channels/telegram/index.ts:39` — `TelegramChannel` class extends `BaseChannel<TelegramChannelConfig>`.

### grammY Bot Lifecycle

1. **Init** (index.ts:80): Create `Bot<Context>` with token.
2. **Register handlers** (index.ts ~140): Call `registerTelegramHandlers(bot, deps)` (handlers.ts:45).
3. **Start** (index.ts:start()): `bot.start()` begins long-polling. Promise stored in `pollingPromise` for graceful stop.
4. **Stop** (index.ts:stop()): Signal `bot.stop()` and drain `pollingPromise`.

### Slash Commands

| Command | Handler file | Output |
|---------|--------------|--------|
| `/start` | index.ts:89-120 | Issues pairing challenge (unauthorized users only) |
| `/portfolio` | commands/portfolio.ts | Equity, PnL, wallet breakdown |
| `/positions` | commands/positions.ts | Open positions with size, entry, liq, margin |
| `/news` | commands/news.ts | Recent market news |
| `/price <symbol>` | commands/price.ts | Price, 24h change, funding |
| `/alerts` | commands/alerts.ts | Fired and active price alerts |

Registered via `TelegramChannel.constructor` → index.ts:115-119. Command list in index.ts:30-37.

### Message Routing Hierarchy

```
Telegram message arrives
  ├─ Approval callback? → handlers.ts:51-75 → approvalManager.resolve()
  ├─ Text with slash command at offset 0? → /command handlers
  ├─ Allowed user + pending approval + user types "y"/"yes"? → auto-resolve (handlers.ts:95)
  ├─ DM from unauthorized? → pairing challenge (handlers.ts:99-102)
  └─ Allowed user DM + not a command? → route to orchestrator via bus (handlers.ts:107)
```

**Formatting:** TelegramFormatter (format/index.ts) converts agent responses to HTML/Markdown with escaping and Telegram-native tables. Chart extraction via `extractCharts()` (format/tags.ts).

## Pairing Flow

Unauthorized users receive a challenge code. Approval happens via web dashboard callback.

```
sequenceDiagram
  participant U as Unauthorized User
  participant TG as Telegram Bot
  participant PS as PairingService
  participant DB as Allowlist DB
  participant WEB as Web Dashboard
  participant U as User (Admin)

  U->>TG: Send DM or /start
  TG->>TG: Check allowlist → not found
  TG->>PS: issueChallenge(identity)
  PS->>DB: upsertRequest(code)
  PS-->>TG: code
  TG-->>U: Challenge text + code
  U-->>U: Copy code
  U->>WEB: Paste code in pairing modal
  WEB->>DB: approveRequest(code)
  DB->>DB: Move from pending to allowlist
  WEB-->>U: ✓ Approved
  U->>TG: Send DM again
  TG->>TG: Check allowlist → found
  TG->>TG: Route text to orchestrator
```

**Code:** PairingService.issueChallenge() (pairing/service.ts:30-71), approveRequest() (pairing/service.ts:75-85). TTL: 1 hour (pairing/service.ts:68).

## How to Add a Channel

1. **Extend BaseChannel** with your config (Zod schema).
2. **Implement contract:** `start()`, `stop()`, `send()`, optionally `sendDelta()`.
3. **Register handlers:** Adapt the message routing pattern (e.g., WebSocket subscription, polling loop).
4. **Emit inbound messages:** Push to `bus.publishInbound(InboundMessage)`.
5. **Consume outbound:** Implement `send()` to drain `OutboundMessage`.

**Skeleton (40 LOC):**

```typescript
import { BaseChannel } from '../base';
import type { OutboundMessage } from '../../bus/types';

export class DiscordChannel extends BaseChannel {
  readonly name = 'discord';
  readonly displayName = 'Discord';
  private client: any; // Discord.js Client

  async start(): Promise<void> {
    this.client = new Client({ intents: [...] });
    this.client.on('messageCreate', (msg) => {
      if (!this.isAllowed({ id: msg.author.id })) return;
      this.bus.publishInbound({
        channel: this.name,
        chatId: msg.channelId,
        content: msg.content,
        media: [],
      });
    });
    await this.client.login(this.config.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async send(msg: OutboundMessage): Promise<void> {
    const ch = this.client.channels.cache.get(msg.chatId);
    await ch.send(msg.content);
  }
}
```

## Cross-Surface Inconsistencies

Telegram lacks features available elsewhere:

| Feature | Web | Telegram | Impact |
|---------|-----|----------|--------|
| Trade approvals (cards) | Live + real-time | Reactive button callbacks only | Telegram commands cannot trigger confirmable trades |
| Session history | `/sessions` page | Not available | Users cannot replay past conversations on Telegram |
| Memory introspection | `/memory` page (MEMORY.md, HISTORY.md) | Not available | Telegram has no `/memory` command |

Future: Follow-up tickets to unify these across surfaces.

## Streaming State Machine

Non-streaming and streaming channels have distinct buffering behavior (dispatcher.ts:107-196):

- **Non-streaming:** Buffer all deltas, emit complete message on resolve.
- **Streaming:** Buffer pre-tool narration, discard on tool end. Publish post-tool deltas live. Emit `_stream_end` marker to close stream.

Dispatcher monitors `tool_execution_start/end` and synthetic `toolcall_end` (Claude CLI provider) to arm the `acceptDelta` flag.
