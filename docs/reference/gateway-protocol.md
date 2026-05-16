# Gateway Protocol Reference

## Overview

Ghost exposes a WebSocket-based JSON-RPC protocol for client integrations (web dashboard, Telegram bots, automation scripts, third-party dashboards). The gateway runs on `0.0.0.0:15401` by default (configurable via `config.gateway.host/port`). Loopback bind enforced unless `allowPublicBind=true`.

**WS-first design**: REST surface limited to wallet pairing + chart data. All bidirectional communication flows over WebSocket.

**No in-app auth**: Gateway assumes loopback or allowlist access control. Token pairing optional; real auth is OS-level (firewall, IAM tunnel, VPN).

---

## WebSocket Envelope

The wire protocol is frame-based. Client and server exchange JSON objects with a `type` field.

### Client → Server Frames

```typescript
// Connect (optional token for future extensibility)
{ type: "connect", token?: string }

// Request (fire-and-forget RPC)
{ type: "req", id: string, method: string, payload?: unknown }
```

### Server → Client Frames

```typescript
// Session established
{ type: "hello", sessionId: string }

// Response to a req (success)
{ type: "res", id: string, ok: true, payload?: unknown }

// Response to a req (error)
{ type: "res", id: string, ok: false, error: { code: ErrorCode, message: string } }

// Async event (broadcast or targeted emission)
{ type: "event", event: string, payload?: unknown, seq: number }

// Protocol error (malformed frames, etc.)
{ type: "error", message: string }
```

### Error Codes

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | Token invalid or channel mismatch |
| `NOT_FOUND` | Method or resource not found |
| `BAD_REQUEST` | Payload validation failed |
| `INTERNAL` | Server-side error |
| `NOT_AVAILABLE` | Service temporarily unavailable |

**Events are sequenced** (`seq: number`). Clients can detect loss by tracking gaps. Subscribers can replay history by replaying session events, or request fresh snapshots via RPC.

---

## RPC Methods (69 total)

Methods are grouped by domain. Each has a canonical name, payload shape, response type, and source location (file:line).

### Chat (3 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `chat.send` | `{ message: string, sessionKey?: string, idempotencyKey?: string }` | `{ runId: string, status: string }` | Async — returns runId immediately. Emits `chat.delta`, `chat.tool_call`, `chat.tool_result`, `chat.turn`, `chat.done` events. | `chat.ts:69` |
| `chat.history` | `{ sessionKey?: string, limit?: number }` | `{ sessionKey: string, messages: Array }` | Capped at 1000. Returns last N messages from unified session. | `chat.ts:124` |
| `chat.abort` | `{ runId?: string }` | `{ ok: boolean, aborted: boolean }` | Cancel active run by ID, or all if runId omitted. | `chat.ts:135` |

### Trading - Wallets & Portfolio (6 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.wallets.list` | (none) | `Array<{ address, testnet, status, isDefault }>` | Lists connected wallets. | `trading.ts:36` |
| `trading.portfolio.get` | `{ address?: string }` | `{ connected, address, balance, positions, openOrders, ...}` | Single wallet snapshot. Scoped to address or default. | `trading.ts:40` |
| `trading.portfolio.aggregate` | (none) | `{ connected, totalEquity, totalAvailable, totalUnrealizedPnl, perWallet, ... }` | Cross-wallet aggregate. | `trading.ts:83` |
| `trading.fills.list` | `{ address?: string, all?: boolean, lookbackHours?: number, startTime?, endTime?, symbol?, side? }` | `{ fills, window, capped? }` | Trade history (1000 cap). | `trading.ts:127` |
| `trading.tokens.list` | (none) | `{ tokens, prices, prevDayPrices, maxLeverages }` | All available symbols and metadata. | `trading.ts:186` |
| `trading.price` | `{ symbol: string }` | `{ symbol, price }` | Single ticker snapshot. | `trading.ts:207` |

### Trading - Watchlist & Alerts (5 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.watchlist.list` | (none) | `{ items: Array<{symbol, addedAt}> }` | User's tracked symbols. | `trading.ts:219` |
| `trading.watchlist.add` | `{ symbol: string }` | `{ item }` or `{ error }` | Canonicalized via `resolveSymbol()`. | `trading.ts:227` |
| `trading.watchlist.remove` | `{ symbol: string }` | `{ removed: boolean }` | Tolerates dedup via canonicalization. | `trading.ts:243` |
| `trading.alerts.list` | `{ includeFired?: boolean }` | `Array<{id, symbol, condition, price, note, ...}>` | Alert rules (active or history). | `trading.ts:256` |
| `trading.alerts.remove` | `{ id: string }` | `{ removed: boolean }` | Deletes rule by ID. | `trading.ts:268` |

### Trading - Notifications (2 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.notifications.list` | `{ includeDismissed?: boolean, limit?: number }` | `Array<{id, type, message, ...}>` | Bell-dropdown feed (capped 500). | `trading.ts:281` |
| `trading.notifications.dismiss` | `{ id: string }` | `{ dismissed: boolean }` | Hides notification. | `trading.ts:292` |

### Trading - News (9 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.news.list` | `{ limit?, offset?, importance?, coins?, beforePublishedAt?, beforeId?, afterPublishedAt?, afterId? }` | `{ articles: Array, total: number }` | News feed with pagination. | `trading.ts:305` |
| `trading.news.dismiss` | `{ articleId: string }` | `{ ok: boolean }` or `{ ok: false, error }` | Mark article as read/dismissed. | `trading.ts:332` |
| `trading.news.sources.list` | (none) | `{ sources: Array<{id, name, enabled}> }` | Configured news sources (no apiKey on wire). | `trading.ts:339` |
| `trading.news.sources.toggle` | `{ sourceId: string, enabled: boolean }` | `{ ok: boolean, warning?: string }` | Enable/disable source. | `trading.ts:347` |
| `trading.news.sources.setKey` | `{ sourceId: string, apiKey: string }` | `{ ok: boolean }` | Update API key for a source. | `trading.ts:357` |
| `trading.news.sources.addCustom` | `{ url: string, name: string }` | `{ ok: boolean }` or `{ ok: false, error }` | Add custom RSS feed. | `trading.ts:487` |
| `trading.news.sources.remove` | `{ sourceId: string }` | `{ ok: boolean, error? }` | Delete custom source (presets locked). | `trading.ts:493` |
| `trading.news.filter.get` | (none) | `{ prompt: string }` | Get override or built-in default. | `trading.ts:506` |
| `trading.news.filter.set` | `{ prompt: string }` | `{ ok: boolean, error? }` | Set custom filter (empty = clear override). | `trading.ts:511` |

### Trading - Tweets (12 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.tweets.list` | `{ limit?, beforePublishedAt?, beforeId?, afterPublishedAt?, afterId?, username? }` | `{ tweets: Array, total: number }` | Tweet feed with pagination. | `trading.ts:366` |
| `trading.tweets.dismiss` | `{ id: string }` | `{ ok: boolean, error? }` | Mark tweet as read/dismissed. | `trading.ts:389` |
| `trading.tweets.hasAuth` | (none) | `{ hasAuth: boolean }` | Check if X.com auth configured. | `trading.ts:396` |
| `trading.tweets.status` | (none) | `{ hasAuth, authUser, follows, includeFollowing, fetchState }` | Full X integration status. | `trading.ts:401` |
| `trading.tweets.settings.set` | `{ includeFollowing?: boolean }` | `{ ok: boolean, error? }` | Toggle include-following mode. | `trading.ts:415` |
| `trading.tweets.auth` | `{ auth_token: string, ct0: string }` | `{ ok: boolean, user? }` or `{ ok: false, error }` | Authenticate with X.com cookies. | `trading.ts:425` |
| `trading.tweets.unlink` | (none) | `{ ok: boolean, error? }` | Revoke X.com auth. | `trading.ts:451` |
| `trading.tweets.follows.list` | (none) | `{ follows: Array<{username, displayName}> }` | Tracked X accounts. | `trading.ts:461` |
| `trading.tweets.follows.add` | `{ username: string }` | `{ ok: boolean, error? }` | Add tracked account. | `trading.ts:470` |
| `trading.tweets.follows.remove` | `{ username: string }` | `{ ok: boolean, error? }` | Stop tracking account. | `trading.ts:480` |
| `trading.tweets.filter.get` | (none) | `{ prompt: string }` | Get override or built-in default. | `trading.ts:522` |
| `trading.tweets.filter.set` | `{ prompt: string }` | `{ ok: boolean, error? }` | Set custom filter (empty = clear override). | `trading.ts:527` |

### Approvals (4 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `trading.approval.pending` | `{ sessionKey?: string }` | `{ pending: { approvalId, preview, ... } or null }` | Get current pending confirmation (web-scoped). | `approval-handlers.ts:38` |
| `trading.approval.resolve` | `{ approvalId: string, decision: "approved"\|"rejected", reason?: string }` | `{ ok: true }` | Confirm or reject trade. | `approval-handlers.ts:10` |
| `tool.approval.pending` | `{ sessionKey?: string }` | `{ pending: { approvalId, preview, ... } or null }` | Get pending tool confirmation. | `tool-approval-handlers.ts:26` |
| `tool.approval.resolve` | `{ approvalId: string, decision: "approved"\|"rejected" }` | `{ ok: true }` | Confirm or reject tool use. | `tool-approval-handlers.ts:10` |

### Status & System (2 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `health` | (none) | `{ status: "ok" }` | Liveness probe. | `status.ts:55` |
| `status` | (none) | `{ version, latestVersion, updateAvailable, provider, model, uptime_seconds, channels, clients, showToolCalls, paperMode }` | Full daemon status snapshot. | `status.ts:59` |

### Memory (3 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `memory.get` | (none) | `{ memory: string, history: string }` | Read MEMORY.md + HISTORY.md. | `memory.ts:10` |
| `memory.write` | `{ content: string }` | `{ ok: true }` | Overwrite MEMORY.md. | `memory.ts:19` |
| `memory.clear` | (none) | `{ ok: true }` | Wipe MEMORY.md (set to empty string). | `memory.ts:26` |

### Tools (1 method)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `tools.list` | (none) | `{ tools: Array<{name, description, parameters}> }` | Available tools + schemas. | `tools.ts:9` |

### Sessions (4 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `sessions.list` | `{ limit?: number, offset?: number }` | `{ sessions: Array, total: number }` | List session keys (pagination). | `sessions.ts:9` |
| `sessions.preview` | `{ keys: string[], limit?: number, maxChars?: number }` | `{ previews: Array<{key, status, items}> }` | Batch preview 3 recent messages per session. | `sessions.ts:20` |
| `sessions.reset` | `{ sessionKey: string }` | `{ ok: true, key: string }` | Clear session history (delete). | `sessions.ts:58` |
| `sessions.delete` | `{ sessionId: string }` | `{ ok: true }` | Alias for reset (backward-compat). | `sessions.ts:65` |

### Cron (5 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `cron.list` | (none) | `{ jobs: Array<{id, name, schedule, command, enabled, ...}> }` | All scheduled jobs. | `cron.ts:42` |
| `cron.status` | (none) | `{ ...status object }` | Scheduler state (execution metrics). | `cron.ts:46` |
| `cron.add` | `{ name?: string, schedule: string, command: string, enabled?: boolean }` | `{ job }` | Create job. Schedule: `every:Xms`, `cron:expr`, or `at:ISO-datetime`. | `cron.ts:48` |
| `cron.remove` | `{ jobId: string }` | `{ removed: boolean }` | Delete job. | `cron.ts:63` |
| `cron.run` | `{ jobId: string, mode?: "due"\|"force" }` | `{ ok: true }` | Execute job now (broadcasts `cron.executed`). | `cron.ts:70` |

### Skills (3 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `skills.list` | (none) | `{ skills: Array<{name, description, enabled, ...}> }` | Loaded skills (syncs every 5s). | `skills.ts:12` |
| `skills.toggle` | `{ name: string, enabled: boolean }` | `{ ok: true }` | Enable/disable skill. | `skills.ts:21` |
| `skills.delete` | `{ name: string }` | `{ ok: boolean, ... }` | Unload skill file. | `skills.ts:30` |

### Channels (6 methods)

| Method | Payload | Response | Notes | Source |
|--------|---------|----------|-------|--------|
| `channels.list` | (none) | `{ channels: Array<{id, label, description, enabled, running}> }` | Available channels + running state. | `channels.ts:57` |
| `channels.status` | `{ id?: string, probe?: boolean }` | `{ ...plugin-specific status, running, pendingCount }` | Channel status + pending pairing requests. | `channels.ts:73` |
| `channels.setup` | `{ id?: string, token: string }` | `{ ok: true, summary }` or error | Connect channel (bot token, etc.). | `channels.ts:86` |
| `channels.remove` | `{ id?: string }` | `{ ok: true, summary }` or error | Disconnect channel. | `channels.ts:123` |
| `channels.pairing.list` | `{ id?: string }` | `{ requests: Array<{code, senderId, username, createdAt, expiresAt, ...}> }` | Pending pairing requests. | `channels.ts:146` |
| `channels.pairing.approve` | `{ id?: string, code: string, notify?: boolean }` | `{ ok: true, identity, notified?, notifyError? }` or `{ ok: false, reason }` | Approve pairing request. | `channels.ts:156` |
| `channels.allowlist.list` | `{ id?: string }` | `{ entries: Array<{identity, displayName, addedAt, ...}> }` | Approved identities. | `channels.ts:194` |
| `channels.allowlist.remove` | `{ id?: string, identity: string }` | `{ ok: boolean }` | Revoke channel access. | `channels.ts:204` |

---

## Events (Broadcast)

Events are emitted to all subscribed clients. Each event has a type, optional payload, and sequence number.

| Event | Payload | Emitter | Purpose |
|-------|---------|---------|---------|
| `trading.price.update` | `{ symbol: string, price: number }` | `server.ts:249` (price feed) | Price tick for watched symbols. |
| `trading.watchlist.changed` | `{ action: "add"\|"remove", symbol: string }` | `server.ts:196` | Watchlist modified (by RPC or tool). |
| `trading.tweets.inserted` | `{ count: number, source: "following"\|"manual" }` | (tweet service) | New tweets fetched. |
| `trading.alert.set` | `{ id, symbol, condition, price, note? }` | (alert service) | Alert rule created. |
| `trading.alert.removed` | `{ id, symbol }` | (alert service) | Alert rule deleted. |
| `trading.approval.requested` | `{ approvalId, sessionKey, preview, origin?, ... }` | (tool/orchestrator) | Confirmation card needed. |
| `trading.approval.resolved` | `{ approvalId, decision, ts }` | (approval manager) | Confirmation resolved. |
| `tool.approval.requested` | `{ approvalId, preview, createdAtMs }` | (tool system) | Tool confirmation needed. |
| `tool.approval.resolved` | `{ approvalId, decision, ts }` | (approval manager) | Tool confirmation resolved. |
| `wallet.changed` | `{ action, address, ... }` | `server.ts:328,383,398,410,424` | Wallet connected/removed/updated. |
| `client.connected` | `{ clients: number }` | (client manager) | New WS client joined. |
| `client.disconnected` | `{ clients: number }` | (client manager) | WS client dropped. |
| `chat.proactive` | `{ id?, source: string, content: string, ts: number }` | (proactive observer) | Unsolicited assistant message. |
| `pairing.request.created` | `{ channel, code, senderId, username?, createdAt, expiresAt }` | (pairing service) | New pairing challenge. |
| `pairing.request.approved` | `{ channel, code, senderId, username? }` | (pairing service) | Pairing approved. |
| `pairing.request.removed` | `{ channel, code, reason: "rejected"\|"expired" }` | (pairing service) | Pairing cancelled. |
| `pairing.allowlist.removed` | `{ channel, identity }` | (pairing service) | Revoked identity. |
| `channel.state.changed` | `{ channel, state: "connected"\|"disconnected", bot? }` | `channels.ts:111,141` | Channel connected/disconnected. |
| `proactive.decision` | `{ decision: "fire"\|"silent", topic?, symbol?, reason?, ts }` | (observer) | Telemetry: proactive decision taken. |
| `observer.tick` | `{ eventCount, decision, primaryEventType?, primarySymbol?, reason?, ts }` | (observer) | Telemetry: observer completed a cycle. |
| `mcp.tool_result` | `{ toolCallId, name, success, durationSecs? }` | (MCP integration) | Tool result from external server. |

---

## Authentication & Access Control

### Gateway Security Model

- **No in-app sessions**: Gateway has no login/logout. Client identity is managed by OS-level access (firewall, VPN, IAM tunnel).
- **Loopback bind default**: Listening on `127.0.0.1:15401` by default — accessible only from localhost.
- **Public bind gated**: Non-loopback bind (e.g., `0.0.0.0:15401`) requires `config.gateway.allowPublicBind=true`.
- **Optional token**: ConnectFrame accepts a `token` field for future extensibility (currently unused).

### Channel Pairing Flow

Channels (Telegram, etc.) require a separate allowlist mechanism:

1. **Pairing initiation**: User sends `/start` command in Telegram → bot issues a challenge code.
2. **Approval**: User responds with code on web dashboard → `channels.pairing.approve` RPC.
3. **Allowlist entry**: Identity (Telegram user ID, X username, etc.) added to pairing store.
4. **Broadcast gate**: Approval events only broadcast if origin channel matches subscriber's allowlist.

See [`gateway-events.md`](./gateway-events.md) and [Architecture: Channels](./channels.md) for detailed pairing sequence diagrams.

---

## Sample JavaScript Client

```javascript
const WS_URL = "ws://127.0.0.1:15401";

class GatewayClient {
  constructor() {
    this.ws = null;
    this.requestId = 0;
    this.handlers = new Map(); // id -> { resolve, reject, timeout }
    this.eventSubscribers = new Map(); // event type -> [callback, ...]
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
      this.ws.onerror = reject;
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ type: "connect" }));
        resolve();
      };
    });
  }

  _onMessage(frame) {
    if (frame.type === "hello") {
      console.log("Connected:", frame.sessionId);
    } else if (frame.type === "res") {
      const h = this.handlers.get(frame.id);
      if (h) {
        clearTimeout(h.timeout);
        frame.ok ? h.resolve(frame.payload) : h.reject(frame.error);
        this.handlers.delete(frame.id);
      }
    } else if (frame.type === "event") {
      const subs = this.eventSubscribers.get(frame.event) || [];
      subs.forEach(cb => cb(frame.payload));
    } else if (frame.type === "error") {
      console.error("Protocol error:", frame.message);
    }
  }

  call(method, payload = {}) {
    const id = String(++this.requestId);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.handlers.delete(id);
          reject(new Error("Request timeout"));
        },
        10000
      );
      this.handlers.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ type: "req", id, method, payload }));
    });
  }

  subscribe(eventType, callback) {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, []);
    }
    this.eventSubscribers.get(eventType).push(callback);
  }
}

// Usage
const client = new GatewayClient();
await client.connect();

// Send a chat message
const { runId } = await client.call("chat.send", { message: "What's the BTC price?" });
console.log("Running:", runId);

// Subscribe to events
client.subscribe("chat.delta", (delta) => console.log("Delta:", delta));
client.subscribe("trading.approval.requested", (approval) => {
  console.log("Approval requested:", approval.approvalId);
  // Respond with: client.call("trading.approval.resolve", { approvalId, decision: "approved" })
});

// Respond to an approval
await client.call("trading.approval.resolve", {
  approvalId: "uuid-here",
  decision: "approved",
});
```

---

## Cross-References

- **Network security**: `docs/security/network-exposure.md` — deployment & firewall guidelines.
- **Channels & pairing**: [`docs/reference/channels.md`](./channels.md) — WebSocket client integrations, Telegram setup, allowlist.
- **Architecture**: [`docs/reference/architecture.md`](./architecture.md) — gateway place in daemon lifecycle.
- **Security policy**: [`docs/reference/security.md`](./security.md) — approval policies, autonomy levels.
