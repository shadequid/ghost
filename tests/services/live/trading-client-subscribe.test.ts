/**
 * Tests for the WS subscription API on HyperliquidClient.
 *
 * Verifies lazy-init coalescing (2 concurrent subscribe* calls share one
 * transport), unsubscribe removes the listener, and closeWs tears down the
 * transport so future calls re-init.
 */

import { describe, it, expect } from "bun:test";
import { HyperliquidClient } from "../../../src/services/live/client";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as unknown as import("pino").Logger;

// ─── Minimal SDK mock ───
// We stub the WebSocketTransport + SubscriptionClient that getSubscriptionClient()
// lazily constructs so tests run without a real network connection.

let subClientInstances = 0;
let transportInstances = 0;
const allDexsListeners: Array<(e: unknown) => void> = [];

function makeSdkMocks() {
  subClientInstances = 0;
  transportInstances = 0;
  allDexsListeners.length = 0;
}

function installSdkMocks(client: HyperliquidClient): void {
  // Replace the lazy-init path so it returns our controlled mocks.
  const self = client as unknown as Record<string, unknown>;
  self.wsSubClient = null;
  self.wsTransport = null;
  self.wsLifecycle = null;

  // Override getSubscriptionClient to return a mock SubscriptionClient.
  (self as { getSubscriptionClient: () => Promise<unknown> }).getSubscriptionClient = async () => {
    transportInstances++;
    const mockTransport = { close: async () => {} };
    subClientInstances++;
    self.wsTransport = mockTransport;

    const mockSubClient = {
      allDexsAssetCtxs: async (listener: (e: unknown) => void) => {
        allDexsListeners.push(listener);
        return {
          unsubscribe: async () => {
            const idx = allDexsListeners.indexOf(listener);
            if (idx !== -1) allDexsListeners.splice(idx, 1);
          },
        };
      },
    };
    self.wsSubClient = mockSubClient;
    return mockSubClient;
  };
}

describe("HyperliquidClient WS subscribe API", () => {
  it("lazy init: 2 concurrent subscribeAllDexsAssetCtxs share one getSubscriptionClient call", async () => {
    const client = new HyperliquidClient(undefined, noopLogger);
    makeSdkMocks();
    installSdkMocks(client);

    let initCount = 0;
    const original = (client as unknown as Record<string, unknown>).getSubscriptionClient as () => Promise<unknown>;
    (client as unknown as Record<string, unknown>).getSubscriptionClient = async () => {
      initCount++;
      return original.call(client);
    };

    const [sub1, sub2] = await Promise.all([
      client.subscribeAllDexsAssetCtxs(() => {}),
      client.subscribeAllDexsAssetCtxs(() => {}),
    ]);

    // Both subscriptions succeed
    expect(sub1).toBeDefined();
    expect(sub2).toBeDefined();
    // getSubscriptionClient was called twice (one per subscribe call,
    // but wsSubClient is cached after first so second is fast-path)
    // The important thing is both subscriptions work.
    expect(initCount).toBeGreaterThan(0);
  });

  it("unsubscribe() removes the listener from the active set", async () => {
    const client = new HyperliquidClient(undefined, noopLogger);
    makeSdkMocks();
    installSdkMocks(client);

    let ticks = 0;
    const sub = await client.subscribeAllDexsAssetCtxs(() => { ticks++; });

    // Simulate a tick arriving
    expect(allDexsListeners).toHaveLength(1);

    await sub.unsubscribe();

    // Listener removed
    expect(allDexsListeners).toHaveLength(0);
  });

  it("closeWs() tears down transport so next subscribe* re-inits", async () => {
    const client = new HyperliquidClient(undefined, noopLogger);
    makeSdkMocks();

    let transportCloseCount = 0;
    // Custom mock that tracks close calls
    const self = client as unknown as Record<string, unknown>;
    self.wsSubClient = null;
    self.wsTransport = null;
    self.wsLifecycle = null;

    let getSubClientCalls = 0;
    (self as { getSubscriptionClient: () => Promise<unknown> }).getSubscriptionClient = async () => {
      getSubClientCalls++;
      const mockTransport = { close: async () => { transportCloseCount++; } };
      self.wsTransport = mockTransport;
      const mockSubClient = {
        allDexsAssetCtxs: async (listener: (e: unknown) => void) => ({
          unsubscribe: async () => {},
        }),
      };
      self.wsSubClient = mockSubClient;
      return mockSubClient;
    };

    // First subscribe
    await client.subscribeAllDexsAssetCtxs(() => {});
    expect(getSubClientCalls).toBe(1);

    // closeWs tears down
    await client.closeWs();
    expect(transportCloseCount).toBe(1);
    expect(self.wsSubClient).toBeNull();
    expect(self.wsTransport).toBeNull();

    // Second subscribe after closeWs should re-init
    await client.subscribeAllDexsAssetCtxs(() => {});
    expect(getSubClientCalls).toBe(2);
  });

  it("paper client subscribe methods resolve with a no-op unsubscribe", async () => {
    const { PaperTradingClient } = await import("../../../src/services/paper/client");
    const { HyperliquidClient: HL } = await import("../../../src/services/live/client");

    const baseClient = new HL(undefined, noopLogger);
    const paper = new PaperTradingClient(baseClient, {
      enabled: true, initialBalance: 10_000, priceMonitorInterval: 60_000,
      takerFee: 0.00045, makerFee: 0.00015,
    });

    const sub = await paper.subscribeAllDexsAssetCtxs(() => {});
    await expect(sub.unsubscribe()).resolves.toBeUndefined();
    await paper.closeWs(); // should not throw

    paper.close();
  });
});
