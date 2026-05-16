# Gateway Events Reference

## Overview

Ghost's event system broadcasts state changes across all connected WebSocket clients. Events are emitted to subscribed clients in real time with sequence numbers (`seq`) for loss detection and replay support.

Each client receives a `hello` frame upon connection with a unique `sessionId`. Events are scoped by:
- **Broadcast**: sent to all connected clients (e.g., `trading.price.update`)
- **Origin-scoped**: sent only to clients on a specific channel (e.g., approvals on Telegram vs. web)
- **User-scoped**: (future) sent only to authenticated sessions

---

## Event Categories

### Trading Events (5 types)

#### `trading.price.update`
**Trigger**: Price feed tick for a watched symbol.
**Payload**:
```json
{ "symbol": "BTC", "price": 45230.50 }
```
**Emitter**: `server.ts:249` (price feed broadcast after cache update)
**Subscribers**: Web dashboard, price widgets, alert evaluators.
**Frequency**: 1-10 Hz per symbol (configurable in price feed).

---

#### `trading.watchlist.changed`
**Trigger**: Symbol added or removed from watchlist (via RPC or tool).
**Payload**:
```json
{ "action": "add", "symbol": "ETH" }
{ "action": "remove", "symbol": "SOL" }
```
**Emitter**: `server.ts:196` (via `watchlistService.onChanged()`)
**Subscribers**: Dashboard watchlist widget, price feed subscription updater.
**Idempotent**: `remove` on missing symbol is silent.

---

#### `trading.tweets.inserted`
**Trigger**: Batch of tweets fetched and persisted to DB.
**Payload**:
```json
{ "count": 5, "source": "following" }
{ "count": 12, "source": "manual" }
```
**Emitter**: Tweet service (source either user's X.com following or manually tracked accounts)
**Subscribers**: Tweet feed widget (triggers refresh without polling).
**Frequency**: Hourly or on explicit refresh RPC.

---

#### `trading.alert.set`
**Trigger**: New alert rule created (via RPC or tool).
**Payload**:
```json
{
  "id": "alert-uuid-123",
  "symbol": "BTC",
  "condition": "above",
  "price": 50000,
  "note": "Strong resistance level"
}
```
**Emitter**: Alert rules service (on `add()` call)
**Subscribers**: Alert rules list widget, price feed lifecycle (start feed if alerts pending).
**Notes**: Re-evaluates every 5s by observer, not broadcast on trigger.

---

#### `trading.alert.removed`
**Trigger**: Alert rule deleted (via RPC).
**Payload**:
```json
{ "id": "alert-uuid-123", "symbol": "BTC" }
```
**Emitter**: Alert rules service (on `remove()` call)
**Subscribers**: Alert list widget, price feed lifecycle (stop feed if no pending alerts).

---

### Approval Events (4 types)

#### `trading.approval.requested`
**Trigger**: Trading tool requires confirmation before execution.
**Payload**:
```json
{
  "approvalId": "req-uuid-abc",
  "sessionKey": "main",
  "preview": {
    "action": "place_order",
    "actionLabel": "Place Long Order",
    "lines": [
      "Symbol: BTC",
      "Size: 0.5 contracts",
      "Leverage: 2x"
    ],
    "details": { "symbol": "BTC", "size": 0.5 },
    "symbol": "BTC",
    "direction": "long"
  },
  "createdAtMs": 1714521600000,
  "preText": "Confirm trading action",
  "origin": { "channel": "web", "chatId": "client-id" }
}
```
**Emitter**: Orchestrator (after tool parse, before execution) — `approval-events.ts`
**Subscribers**: Web approval card renderer, Telegram approval button handler.
**Workflow**:
1. Client receives event.
2. UI renders confirmation card/button.
3. User decides (→ `trading.approval.resolve` RPC).
4. Tool execution resumes on approval or is aborted on rejection.
**Timeout**: No auto-expiry; card waits indefinitely for explicit user action.

---

#### `trading.approval.resolved`
**Trigger**: User responds to a trading approval.
**Payload**:
```json
{
  "approvalId": "req-uuid-abc",
  "decision": "approved",
  "ts": 1714521605000
}
```
**Emitter**: `approval-handlers.ts:32` (via `approvalManager.resolve()`)
**Subscribers**: Session logger, web UI (dismiss card), Telegram (delete button message).
**Decisions**: `"approved"`, `"rejected"`, or `"expired"` (superseded by new request).

---

#### `tool.approval.requested`
**Trigger**: Tool requires user confirmation.
**Payload**:
```json
{
  "approvalId": "tool-req-xyz",
  "preview": {
    "action": "export_data",
    "actionLabel": "Export Trading Data",
    "lines": [ "Format: CSV", "Scope: Last 30 days" ],
    "details": { "format": "csv" }
  },
  "createdAtMs": 1714521600000
}
```
**Emitter**: Tool approval system (before tool execution)
**Subscribers**: Web tool approval handler, Telegram tool confirmation.
**Workflow**: Identical to trading approvals.

---

#### `tool.approval.resolved`
**Trigger**: User responds to tool approval.
**Payload**: Same as `trading.approval.resolved`.
**Emitter**: `tool-approval-handlers.ts:20`

---

### Wallet Events (1 type)

#### `wallet.changed`
**Trigger**: Wallet connected, disconnected, or trading enabled.
**Payload**:
```json
{ "action": "connect", "address": "0x1234..." }
{ "action": "trading-enabled", "address": "0x1234..." }
{ "action": "remove", "address": "0x1234..." }
{ "action": "set-default", "address": "0x1234..." }
{ "action": "disconnect-source", "source": "metamask", "removed": ["0x...", "0x..."] }
```
**Emitter**: `server.ts:328, 383, 398, 410, 424` (wallet REST endpoints)
**Subscribers**: Web wallet list widget, trading client connection state.
**Idempotent**: `remove` on missing wallet is silent.

---

### Client Lifecycle Events (2 types)

#### `client.connected`
**Trigger**: New WebSocket client connects and handshake completes.
**Payload**:
```json
{ "clients": 2 }
```
**Emitter**: Client manager (on hello frame sent)
**Subscribers**: Status dashboard, price feed lifecycle (start feed if clients > 0).

---

#### `client.disconnected`
**Trigger**: WebSocket client drops (network, close, error).
**Payload**:
```json
{ "clients": 1 }
```
**Emitter**: Client manager (on connection close)
**Subscribers**: Status dashboard, price feed lifecycle (stop feed if clients = 0 AND no active alerts).

---

### Chat Events (1 type — event stream, not broadcast)

#### `chat.proactive`
**Trigger**: Proactive observer produces an unsolicited response.
**Payload**:
```json
{
  "id": "msg-uuid-stable",
  "source": "market-alert",
  "content": "BTC has spiked 5% in the last hour. Consider...",
  "ts": 1714521605000
}
```
**Emitter**: `client-events.ts:32` (from proactive observer/scheduler)
**Subscribers**: Web chat renderer (appends message without user input).
**Notes**: `id` dedupes against `chat.history` fetches (avoiding double-render on F5 during flight).

---

### Pairing Events (4 types)

#### `pairing.request.created`
**Trigger**: Channel pairing flow initiated (e.g., `/start` on Telegram).
**Payload**:
```json
{
  "channel": "telegram",
  "code": "ABC123",
  "senderId": "123456789",
  "username": "alice_trader",
  "createdAt": 1714521600000,
  "expiresAt": 1714521900000
}
```
**Emitter**: Pairing service (on request generation)
**Subscribers**: Web pairing list, Telegram bot (stores for approval handler).
**Expiry**: 5 minutes (300s) by default.

---

#### `pairing.request.approved`
**Trigger**: Web user approves a pairing code.
**Payload**:
```json
{
  "channel": "telegram",
  "code": "ABC123",
  "senderId": "123456789",
  "username": "alice_trader"
}
```
**Emitter**: `channels.ts:111` (after `channels.pairing.approve` RPC)
**Subscribers**: Telegram bot (notifies user of approval), web pairing list (refresh).

---

#### `pairing.request.removed`
**Trigger**: Pairing request expired or was manually rejected.
**Payload**:
```json
{
  "channel": "telegram",
  "code": "ABC123",
  "reason": "expired"
}
{ "channel": "telegram", "code": "ABC123", "reason": "rejected" }
```
**Emitter**: Pairing service (on expiry or rejection)
**Subscribers**: Web UI (refresh list), Telegram (optional notification).

---

#### `pairing.allowlist.removed`
**Trigger**: Approved identity revoked (e.g., `/disconnect`).
**Payload**:
```json
{
  "channel": "telegram",
  "identity": "123456789"
}
```
**Emitter**: `channels.ts:141` (after `channels.allowlist.remove` RPC)
**Subscribers**: Web allowlist widget, Telegram (optional notification).

---

### Channel Management Events (1 type)

#### `channel.state.changed`
**Trigger**: Channel connected or disconnected.
**Payload**:
```json
{ "channel": "telegram", "state": "connected", "bot": "@my_bot" }
{ "channel": "telegram", "state": "disconnected" }
```
**Emitter**: `channels.ts:111, 141` (in `channels.setup` and `channels.remove` handlers)
**Subscribers**: Status dashboard (channel chip), web config panel.

---

### Telemetry Events (2 types)

#### `proactive.decision`
**Trigger**: Proactive observer completes evaluation cycle (fire or silent).
**Payload**:
```json
{
  "decision": "fire",
  "topic": "BTC weakness below 40k",
  "symbol": "BTC",
  "reason": "price_below_threshold",
  "ts": 1714521605000
}
{ "decision": "silent", "topic": null, "symbol": null, "reason": null, "ts": 1714521605000 }
```
**Emitter**: Observer (every 5s evaluation)
**Subscribers**: Diagnostics dashboard, telemetry collectors.
**Purpose**: Instrument decision-making for tuning and debugging.

---

#### `observer.tick`
**Trigger**: Observer completes a cycle (with or without events).
**Payload**:
```json
{
  "eventCount": 3,
  "decision": "fire",
  "primaryEventType": "trading.alert.set",
  "primarySymbol": "BTC",
  "reason": "alert_fired",
  "ts": 1714521605000
}
{ "eventCount": 0, "decision": "skip", "primaryEventType": null, "primarySymbol": null, "reason": null, "ts": 1714521605000 }
```
**Emitter**: Observer loop (proactive-events.ts)
**Subscribers**: Diagnostics dashboard, latency monitors.
**Frequency**: Every 5 seconds (hardcoded in observer).

---

### Tool Integration Events (1 type)

#### `mcp.tool_result`
**Trigger**: MCP (Model Context Protocol) tool execution completes.
**Payload**:
```json
{
  "toolCallId": "call-xyz",
  "name": "web_search",
  "success": true,
  "durationSecs": 2
}
```
**Emitter**: MCP integration layer (tool-events.ts:36)
**Subscribers**: Chat UI (tool execution status bar), telemetry.

---

## Event Sequencing & Loss Detection

All events carry a monotonically increasing `seq` field. Clients detect loss by tracking gaps:

```typescript
// Example: Client receives events with seq: 1, 2, 4
// Detects loss of seq 3 and requests replay or snapshot.
let lastSeq = 0;
ws.onmessage = (frame) => {
  if (frame.type === "event") {
    if (frame.seq !== lastSeq + 1) {
      console.warn(`Lost events: ${lastSeq + 1} to ${frame.seq - 1}`);
      // Trigger snapshot via RPC (e.g., trading.portfolio.get, chat.history)
    }
    lastSeq = frame.seq;
    handleEvent(frame.event, frame.payload);
  }
};
```

---

## Origin Scoping (Channel Pairing)

Approval and pairing events respect channel boundaries:

- **`origin: null`**: Broadcast to all clients (e.g., price updates, wallet changes).
- **`origin: { channel: "web", chatId: "..." }`**: Sent to web clients only.
- **`origin: { channel: "telegram", chatId: "..." }`**: Sent to Telegram subscribers only.

The gateway's `eventBus` routes based on event payload metadata. Subscribers filter by channel if needed.

---

## Best Practices

1. **Subscribe early**: Connect and subscribe to events before calling RPCs that emit them.
2. **Handle loss**: Track `seq` and request snapshots on gaps (don't try to replay from memory).
3. **Idempotent handlers**: Assume events may arrive out-of-order or duplicate; design handlers to be safe.
4. **Debounce updates**: For high-frequency events (price ticks), batch updates in the UI every 100-500ms.
5. **Timeout approvals**: Display a visual indicator if approval pending > 30s (but don't auto-cancel).

---

## Related Documentation

- **Gateway protocol**: `docs/reference/gateway-protocol.md` — RPC methods and envelope.
- **Channels**: [`docs/reference/channels.md`](./channels.md) — WebSocket integrations, Telegram pairing flow.
- **Architecture**: [`docs/reference/architecture.md`](./architecture.md) — event bus design.
