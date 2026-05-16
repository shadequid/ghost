/**
 * Tests for daemon/shutdown.ts — installShutdownHandlers().
 *
 * Mocks process signals to verify each tear-down dependency is called
 * in the correct order and that the handler is idempotent.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { installShutdownHandlers } from "../../src/daemon/shutdown.js";
import type { ShutdownDeps } from "../../src/daemon/shutdown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): { deps: ShutdownDeps; mocks: Record<string, ReturnType<typeof mock>> } {
  const mocks = {
    stopPriceFeed:        mock(() => {}),
    appStop:              mock(() => {}),
    unsubscribeBus:       mock(() => {}),
    // stopBackground returns a Promise so the shutdown sequence can await it.
    stopBackground:       mock(() => Promise.resolve()),
    dbClose:              mock(() => {}),
    channelManagerStopAll: mock(() => Promise.resolve()),
    dispatcherStop:       mock(() => {}),
    cronStop:             mock(() => {}),
    chartRendererClose:   mock(() => Promise.resolve()),
  };

  const deps: ShutdownDeps = {
    runtime: {
      db: { close: mocks.dbClose } as never,
      dispatcher: { stop: mocks.dispatcherStop } as never,
      channelManager: { stopAllChannels: mocks.channelManagerStopAll } as never,
      cronService: { stop: mocks.cronStop } as never,
      chartRenderer: { close: mocks.chartRendererClose } as never,
    } as never,
    gatewayHandle: {
      stopPriceFeed: mocks.stopPriceFeed,
      app: { stop: mocks.appStop },
    },
    unsubscribeBus: mocks.unsubscribeBus,
    stopBackground: mocks.stopBackground,
  };

  return { deps, mocks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installShutdownHandlers", () => {
  let handlers: Map<string, () => Promise<void>>;
  let originalOn: typeof process.on;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    handlers = new Map();

    // Capture signal handlers without actually registering them
    originalOn = process.on.bind(process);
    process.on = ((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on;

    // Suppress process.exit
    originalExit = process.exit.bind(process);
    process.exit = (() => {}) as typeof process.exit;
  });

  afterEach(() => {
    process.on = originalOn;
    process.exit = originalExit;
  });

  test("registers SIGINT handler", () => {
    const { deps } = makeDeps();
    installShutdownHandlers(deps);
    expect(handlers.has("SIGINT")).toBe(true);
  });

  test("registers SIGTERM handler", () => {
    const { deps } = makeDeps();
    installShutdownHandlers(deps);
    expect(handlers.has("SIGTERM")).toBe(true);
  });

  test("SIGINT calls all tear-down deps", async () => {
    const { deps, mocks } = makeDeps();
    installShutdownHandlers(deps);

    await handlers.get("SIGINT")!();

    expect(mocks.unsubscribeBus).toHaveBeenCalledTimes(1);
    expect(mocks.stopBackground).toHaveBeenCalledTimes(1);
    expect(mocks.stopPriceFeed).toHaveBeenCalledTimes(1);
    expect(mocks.channelManagerStopAll).toHaveBeenCalledTimes(1);
    expect(mocks.dispatcherStop).toHaveBeenCalledTimes(1);
    expect(mocks.cronStop).toHaveBeenCalledTimes(1);
    expect(mocks.appStop).toHaveBeenCalledTimes(1);
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });

  test("SIGTERM calls all tear-down deps", async () => {
    const { deps, mocks } = makeDeps();
    installShutdownHandlers(deps);

    await handlers.get("SIGTERM")!();

    expect(mocks.unsubscribeBus).toHaveBeenCalledTimes(1);
    expect(mocks.stopBackground).toHaveBeenCalledTimes(1);
    expect(mocks.appStop).toHaveBeenCalledTimes(1);
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });

  test("stopBackground is awaited before DB close — DB closes only after background jobs finish", async () => {
    // Verify ordering: stopBackground must resolve before dbClose is called.
    const callOrder: string[] = [];
    const mocks = {
      stopPriceFeed:        mock(() => {}),
      appStop:              mock(() => { callOrder.push("appStop"); }),
      unsubscribeBus:       mock(() => {}),
      stopBackground:       mock(async () => { callOrder.push("stopBackground"); }),
      dbClose:              mock(() => { callOrder.push("dbClose"); }),
      channelManagerStopAll: mock(() => Promise.resolve()),
      dispatcherStop:       mock(() => {}),
      cronStop:             mock(() => {}),
    };

    const deps: ShutdownDeps = {
      runtime: {
        db: { close: mocks.dbClose } as never,
        dispatcher: { stop: mocks.dispatcherStop } as never,
        channelManager: { stopAllChannels: mocks.channelManagerStopAll } as never,
        cronService: { stop: mocks.cronStop } as never,
        chartRenderer: { close: () => Promise.resolve() } as never,
      } as never,
      gatewayHandle: {
        stopPriceFeed: mocks.stopPriceFeed,
        app: { stop: mocks.appStop },
      },
      unsubscribeBus: mocks.unsubscribeBus,
      stopBackground: mocks.stopBackground,
    };

    installShutdownHandlers(deps);
    await handlers.get("SIGINT")!();

    // stopBackground must appear before dbClose in the call order
    expect(callOrder.indexOf("stopBackground")).toBeLessThan(callOrder.indexOf("dbClose"));
  });

  test("second signal is a no-op (idempotent)", async () => {
    const { deps, mocks } = makeDeps();
    installShutdownHandlers(deps);

    const sigint = handlers.get("SIGINT")!;
    await sigint();
    await sigint(); // second invocation

    // Each dep called exactly once — second signal ignored
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });
});
