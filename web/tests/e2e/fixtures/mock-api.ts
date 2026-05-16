import type { Page } from '@playwright/test';

export interface MockOpenOrder {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  price: number | null;
  triggerPrice: number | null;
  size: number;
  filled: number;
  reduceOnly: boolean;
  timestamp: number;
}

/**
 * Test-side bridge installed on `window` by `mockGatewayWithOrders` when
 * `exposeBridge: true`. Tests reach it via `page.evaluate`.
 */
export interface E2eGatewayBridge {
  /** Push a server-initiated WS frame (event) to the active stub client. */
  pushEvent: (event: string, payload: unknown) => void;
  /** Replace the canned `trading.portfolio.aggregate` payload (e.g. drop an
   *  order to simulate a successful cancel). */
  setOrders: (orders: MockOpenOrder[]) => void;
}

/**
 * mockGateway — stub out the runtime surface so the SPA renders without a
 * real Ghost daemon behind it.
 *
 * Three layers we have to fake:
 *
 *   1. `sessionStorage['ghost.token']`       — bypasses the `/auto-pair` gate
 *                                              in <AuthProvider>, so
 *                                              <LoadingScreen> resolves
 *                                              immediately. Done via
 *                                              addInitScript so it's set
 *                                              BEFORE any app code runs.
 *
 *   2. REST endpoints (`/auto-pair`,         — route-intercepted with canned
 *      `/health`, `/api/*`, `/pair`)            JSON. Most pages don't hit
 *                                              these directly (the app prefers
 *                                              the WS RPC surface) but the
 *                                              gateway status poll and a few
 *                                              wallet/chart endpoints do.
 *
 *   3. WebSocket `/ws`                       — replaced in-page with a stub
 *                                              that emits the `hello` frame
 *                                              on connect and answers any
 *                                              `req` frame with an empty-ish
 *                                              shape keyed on the method name.
 *                                              This keeps widget panels out
 *                                              of perpetual loading state
 *                                              without us maintaining a
 *                                              full RPC replay table.
 *
 * The goal is not fidelity — it's to get past the loading gates with
 * zero uncaught errors, so the CSS/render assertions actually run.
 */
export async function mockGateway(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // --- 1. Pre-seed auth token ---------------------------------------
    try {
      sessionStorage.setItem('ghost.token', 'e2e-mock-token');
    } catch {
      // ignore — privacy modes might block this, but Chromium in tests won't
    }

    // --- 3. WebSocket stub --------------------------------------------
    // Swap the global WebSocket for one that talks the Ghost gateway
    // protocol locally. We only care about /ws URLs; anything else
    // (e.g. third-party libs) falls back to the real implementation.
    const RealWebSocket = window.WebSocket;

    // Canned responses keyed by RPC method. Empty shapes are fine — the
    // UI just needs a well-typed payload so it exits "loading" state.
    const responses: Record<string, unknown> = {
      status: {
        provider: 'mock',
        model: 'mock',
        version: '0.0.0-e2e',
        paperMode: false,
        showToolCalls: false,
      },
      'memory.get': { memory: '', history: '' },
      'skills.list': { skills: [] },
      'tools.list': { tools: [] },
      'cron.list': { jobs: [] },
      'sessions.list': { sessions: [], total: 0 },
      'sessions.preview': { previews: [] },
      'chat.history': { sessionKey: 'e2e', messages: [] },
      'trading.wallets.list': [],
      'trading.portfolio.aggregate': {
        connected: false,
        totalValue: 0,
        totalPnl: 0,
        positions: [],
      },
      'trading.alerts.list': [],
      'trading.tweets.status': { hasAuth: false, authUser: null, follows: [] },
      'trading.tweets.list': { tweets: [], total: 0 },
      'trading.news.sources.list': { sources: [] },
      'trading.news.list': { articles: [], total: 0 },
      'trading.watchlist.list': { items: [] },
      'trading.tokens.list': { tokens: [] },
    };

    class StubWebSocket {
      url: string;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(url: string | URL) {
        this.url = typeof url === 'string' ? url : url.toString();
        // Simulate async open
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));
        });
      }
      send(data: string) {
        try {
          const frame = JSON.parse(data);
          if (frame.type === 'connect') {
            // Emit hello
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({ type: 'hello', sessionId: 'e2e-session' }),
              }),
            );
            return;
          }
          if (frame.type === 'req') {
            const payload =
              responses[frame.method] ?? (Array.isArray(responses[frame.method]) ? [] : {});
            // Slight delay so useEffect-driven loading states have time to register.
            setTimeout(() => {
              this.onmessage?.(
                new MessageEvent('message', {
                  data: JSON.stringify({
                    type: 'res',
                    id: frame.id,
                    ok: true,
                    payload,
                  }),
                }),
              );
            }, 0);
          }
        } catch {
          // ignore malformed
        }
      }
      close() {
        this.readyState = 3;
        this.onclose?.(new CloseEvent('close'));
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    }

    // Swap the global WebSocket class directly. Using Proxy with a construct
    // trap crashed during bootstrap ("Cannot convert undefined or null to
    // object") on at least one browser engine — direct replacement is both
    // simpler and more reliable for our needs. We only ever connect to /ws
    // in this app, so we don't bother preserving the real class.
    void RealWebSocket;
    (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;
  });

  // --- 2. REST route interception -------------------------------------
  // Fallthrough handler for any gateway REST endpoint we forgot.
  await page.route('**/auto-pair', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-mock-token' }),
    });
  });

  await page.route('**/pair', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-mock-token' }),
    });
  });

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, paired: true }),
    });
  });

  await page.route('**/api/**', async (route) => {
    // Generic empty-ish response for any /api/* GET/POST.
    const url = route.request().url();
    if (url.includes('/api/wallets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }
    if (url.includes('/api/chart-data')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candles: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
}

/**
 * mockGatewayWithOrders — extends `mockGateway` for the cancel-order flow.
 *
 * Differences from `mockGateway`:
 *   - `trading.portfolio.aggregate` returns a connected wallet with the
 *     supplied `openOrders`, so `<OrderCard>` rows render.
 *   - `trading.wallets.list` returns one default mock wallet, so the
 *     portfolio provider treats the state as "connected".
 *   - When `exposeBridge: true`, installs `window.__e2eGatewayBridge`
 *     for the test to push server frames (`trading.approval.requested`,
 *     `trading.approval.resolved`, etc.) at controlled timings.
 *
 * The existing `mockGateway` is untouched so `smoke.spec.ts` keeps passing.
 */
export async function mockGatewayWithOrders(
  page: Page,
  opts: { orders: MockOpenOrder[]; exposeBridge?: boolean },
): Promise<void> {
  const { orders, exposeBridge = true } = opts;

  await page.addInitScript(
    ({ initialOrders, bridge }) => {
      try {
        sessionStorage.setItem('ghost.token', 'e2e-mock-token');
      } catch {
        // ignore
      }

      const RealWebSocket = window.WebSocket;

      // Mutable per-window state so the bridge can replace orders mid-test.
      const state: { orders: unknown[] } = { orders: initialOrders };

      const buildAggregate = () => ({
        connected: true,
        totalEquity: 10_000,
        totalAvailable: 9_500,
        totalUnrealizedPnl: 0,
        positionCount: 0,
        orderCount: state.orders.length,
        walletCount: 1,
        perWallet: [
          {
            address: '0xE2E000000000000000000000000000000000E2E0',
            status: 'trading',
            testnet: false,
            balance: {
              totalEquity: 10_000,
              availableBalance: 9_500,
              usedMargin: 500,
              unrealizedPnl: 0,
            },
            positions: [],
            openOrders: state.orders,
          },
        ],
      });

      const mockWallets = () => [
        {
          address: '0xE2E000000000000000000000000000000000E2E0',
          testnet: false,
          isDefault: true,
          source: 'e2e',
          status: 'trading',
          apiWalletAddress: '0xAPI000000000000000000000000000000000AP10',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ];

      const responses: Record<string, unknown> = {
        status: {
          provider: 'mock',
          model: 'mock',
          version: '0.0.0-e2e',
          paperMode: false,
          showToolCalls: false,
          // Required for Dashboard.tsx — Object.entries(status.channels).
          channels: {},
        },
        'memory.get': { memory: '', history: '' },
        'skills.list': { skills: [] },
        'tools.list': { tools: [] },
        'cron.list': { jobs: [] },
        'sessions.list': { sessions: [], total: 0 },
        'sessions.preview': { previews: [] },
        'chat.history': { sessionKey: 'e2e', messages: [] },
        'trading.alerts.list': [],
        'trading.tweets.status': { hasAuth: false, authUser: null, follows: [] },
        'trading.tweets.list': { tweets: [], total: 0 },
        'trading.news.sources.list': { sources: [] },
        'trading.news.list': { articles: [], total: 0 },
        'trading.watchlist.list': { items: [] },
        'trading.tokens.list': { tokens: [], prices: {}, prevDayPrices: {} },
        // chat.send is best-effort acked — the test pushes server events
        // separately via the bridge.
        'chat.send': { runId: 'e2e-run', status: 'ok' },
        'chat.abort': { ok: true },
        'trading.approval.resolve': { ok: true },
      };

      type Listener = (ev: MessageEvent) => void;
      const sockets: { onmessage: Listener | null }[] = [];
      let seq = 0;

      class StubWebSocket {
        url: string;
        readyState = 0;
        onopen: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onclose: ((ev: CloseEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        constructor(url: string | URL) {
          this.url = typeof url === 'string' ? url : url.toString();
          sockets.push(this);
          queueMicrotask(() => {
            this.readyState = 1;
            this.onopen?.(new Event('open'));
          });
        }
        send(data: string) {
          try {
            const frame = JSON.parse(data);
            if (frame.type === 'connect') {
              this.onmessage?.(
                new MessageEvent('message', {
                  data: JSON.stringify({ type: 'hello', sessionId: 'e2e-session' }),
                }),
              );
              return;
            }
            if (frame.type === 'req') {
              let payload: unknown;
              if (frame.method === 'trading.portfolio.aggregate') {
                payload = buildAggregate();
              } else if (frame.method === 'trading.wallets.list') {
                payload = mockWallets();
              } else {
                payload = responses[frame.method] ?? {};
              }
              setTimeout(() => {
                this.onmessage?.(
                  new MessageEvent('message', {
                    data: JSON.stringify({
                      type: 'res',
                      id: frame.id,
                      ok: true,
                      payload,
                    }),
                  }),
                );
              }, 0);
            }
          } catch {
            // ignore
          }
        }
        close() {
          this.readyState = 3;
          this.onclose?.(new CloseEvent('close'));
        }
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {
          return true;
        }
      }

      void RealWebSocket;
      // Mirror standard WebSocket readyState constants on the stub so any
      // code that reads `WebSocket.OPEN` (e.g. `gateway.ts:request`) gets
      // the expected number rather than `undefined`.
      (StubWebSocket as unknown as Record<string, number>).CONNECTING = 0;
      (StubWebSocket as unknown as Record<string, number>).OPEN = 1;
      (StubWebSocket as unknown as Record<string, number>).CLOSING = 2;
      (StubWebSocket as unknown as Record<string, number>).CLOSED = 3;
      (window as unknown as { WebSocket: unknown }).WebSocket = StubWebSocket;

      if (bridge) {
        (window as unknown as Record<string, unknown>).__e2eGatewayBridge = {
          pushEvent(event: string, payload: unknown) {
            seq += 1;
            const data = JSON.stringify({ type: 'event', event, payload, seq });
            for (const ws of sockets) {
              ws.onmessage?.(new MessageEvent('message', { data }));
            }
          },
          setOrders(next: unknown[]) {
            state.orders = next;
          },
        };
      }
    },
    { initialOrders: orders, bridge: exposeBridge },
  );

  // REST routes — identical to mockGateway's set, but `/api/wallets` now
  // mirrors the mock wallet so the AgentChat empty-state check
  // (`fetch("/api/wallets")`) doesn't flip back to "no wallet".
  await page.route('**/auto-pair', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-mock-token' }),
    });
  });
  await page.route('**/pair', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-mock-token' }),
    });
  });
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, paired: true }),
    });
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/wallets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { address: '0xE2E000000000000000000000000000000000E2E0', isDefault: true },
        ]),
      });
      return;
    }
    if (url.includes('/api/chart-data')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candles: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
}
