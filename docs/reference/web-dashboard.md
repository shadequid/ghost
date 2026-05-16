# Web Dashboard Architecture

The Ghost dashboard is a React + Tailwind SPA. It connects to the gateway over WebSocket for real-time chat, approvals, and portfolio data.

## Routes

Web entry: `web/src/App.tsx`. All routes wrapped in `<GatewayProvider>` + `<ChartPanelProvider>` + locale context.

| Path | Component | Purpose | Lazy-loaded |
|------|-----------|---------|-------------|
| `/` | AgentChat | Primary chat interface + approval cards | No (eager) |
| `/dashboard` | Dashboard | Portfolio snapshot (equity, PnL, positions) | Yes |
| `/tools` | Tools | List available tools + toggles | Yes |
| `/skills` | Skills | Skill management + upload modal | Yes |
| `/cron` | Cron | Scheduled job list/editor | Yes |
| `/memory` | Memory | MEMORY.md + HISTORY.md viewer | Yes |
| `/config` | Config | Wallet pairing + gateway settings | Yes |
| `/cost` | Cost | Token usage + API cost breakdown | Yes |
| `/logs` | Logs | Live event tail (structured log viewer) | Yes |
| `/sessions` | Sessions | Chat history + replay | Yes |
| `/chart` | Chart | Technical analysis chart panel | Yes |

AgentChat is eager-loaded to avoid network round-trip on first paint (App.tsx:6-8).

## Connection Model

### GatewayProvider

Location: `web/src/components/GatewayProvider.tsx`.

Wraps the app with a context that manages a single `GatewayClient` instance:

```
App.tsx:32-33
  <GatewayProvider>
    <GatewayContext.Provider value={...}>
      <Routes>...</Routes>
    </GatewayContext.Provider>
  </GatewayProvider>
```

**useGateway()** hook (hooks/useGateway.ts:18-24):
- Returns `{ client, connected, sessionId, error, request, subscribe }`
- Throws if used outside provider.
- `request()` sends RPC methods; `subscribe()` registers event listeners.

**useGatewayClient()** hook (hooks/useGateway.ts:27-85):
- Creates and manages the `GatewayClient` lifecycle.
- Reconnects automatically on close (exponential backoff, max 15s).
- Aggregates all event handlers in a Set.

### GatewayClient

Location: `web/src/lib/gateway.ts:51-187`.

- **Connection:** WebSocket to `{protocol}://{host}/ws` (auto-upgrades to `wss:` for HTTPS).
- **Protocol:** Connect frame → hello response → method-based RPC with ID correlation (protocol.ts:6-57).
- **Timeouts:** 30s default per request.
- **Backoff:** 800ms initial, 1.7x factor, 15s max.

Pending requests tracked by ID in a Map. On timeout, promise rejects. On response, resolved by ID.

### Event Stream

useChatEvents() hook (hooks/useChatEvents.ts:53-200+) subscribes to `chat.event` frames:

```typescript
subscribe((evt: EventFrame) => {
  if (evt.event === 'chat.message_delta') {
    // Buffer text, render live or complete message
  } else if (evt.event === 'trading.approval.requested') {
    // Render approval card
  } else if (evt.event === 'trading.tool.hint') {
    // Show tool execution hint
  }
});
```

Stream metadata:
- `_stream_delta`: True for partial text (Telegram streaming).
- `_stream_id`: Unique per prompt turn.
- `_stream_end`: Marks end of streaming response.

## Approval Card UX

**Trigger:** `trading.approval.requested` event from gateway.

**Render path:**
- `web/src/pages/AgentChat.tsx` → `useChatEvents()` → sets approval state.
- Card rendered inline in chat history.
- Two buttons: "Approve" (green) + "Reject" (red).

**Approval:** User clicks "Approve" → `request('trading.approval.resolve', { approvalId, decision: 'approve' })` → gateway removes card → chat continues.

**Reject:** User clicks "Reject" → Modal prompts for reason → `decision: 'reject'` + reason text → approval stored with rejection note → dashboard shows reason.

**Live dismiss:** Pending approvals auto-dismiss if agent cancels the request (checks pending list before rendering).

## Streaming UX

**Delta render:** Non-blocking. As `chat.message_delta` events arrive, accumulate text in state. RAF-throttled renders to prevent thrashing.

**Tool hints:** During tool execution, `trading.tool.hint` events carry hint text (e.g., "checking portfolio..."). Rendered as an inline chip below the chat input.

**Stream end:** `_stream_end` marker closes the streaming window. All accumulated deltas flushed to final message.

**Non-streaming channels (Telegram):** Deltas coalesce in the dispatcher, arrive as single `chat.message` (no `_stream_delta` metadata).

## Build & Dev Workflow

**Dev server:** `bun run web:dev` (Vite HMR on localhost:5173, reverse-proxied to gateway on 15401).

```bash
cd web && bun run dev
```

**Production build:** `bun run web:build` outputs to `web/dist/`.

```bash
bun run web:build
```

**Daemon serves SPA:** Gateway (ElysiaJS, daemon/index.ts:264) serves `GET /` → `web/dist/index.html` (src/gateway/server.ts:146).

**CSS:** Tailwind (tailwind.config.ts). Design tokens (color, spacing, motion) in `web/DESIGN.md` — do NOT duplicate here. Link to `web/DESIGN.md` for typography, button styles, overlay rules, and accessibility.

## Type Safety

All RPC methods typed via gateway protocol enums. Chat types (ChatMessage, ToolCallEntry) in `web/src/lib/chatTypes.ts`. Error types in `web/src/lib/inline-error-text.ts`.

Store-less architecture: all state in React hooks (`useState`, `useRef`, `useContext`). No Redux / Zustand.
