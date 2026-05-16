/**
 * Signal handlers and tear-down sequence for the Ghost daemon.
 *
 * Installs SIGINT + SIGTERM handlers. On signal:
 *   1. Unsubscribe EventBus listeners.
 *   2. Await BackgroundJobRunner.stop() — lets in-flight jobs finish so they
 *      do not hit a closed DB mid-write.
 *   3. Stop price feed, channels, cron, chart renderer, gateway.
 *   4. Close DB + exit.
 */

import type { Runtime } from "../runtime.js";

export interface ShutdownDeps {
  runtime: Runtime;
  /** Return value of gateway — need stopPriceFeed + app.stop */
  gatewayHandle: {
    stopPriceFeed: () => void;
    app: { stop: () => void };
  };
  unsubscribeBus: () => void;
  /** Returns a Promise so the shutdown sequence can await in-flight job completion. */
  stopBackground: () => Promise<void>;
}

/**
 * Install SIGINT and SIGTERM handlers. Both signals invoke the same
 * tear-down sequence exactly once (subsequent signals are ignored after
 * the first invocation — the process is already exiting).
 *
 * The handler is async so it can await BackgroundJobRunner.stop() before
 * tearing down the DB — preventing "database is closed" errors from jobs
 * that are still writing when the signal arrives.
 */
export function installShutdownHandlers(deps: ShutdownDeps): void {
  const {
    runtime,
    gatewayHandle,
    unsubscribeBus,
    stopBackground,
  } = deps;
  const { db, dispatcher, channelManager, cronService, chartRenderer } = runtime;
  const { stopPriceFeed, app } = gatewayHandle;

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    unsubscribeBus();
    console.log("\nGhost daemon shutting down...");
    // Await in-flight background jobs before touching the DB — jobs may still
    // be writing summaries or news entries; closing the DB under them risks
    // "database is closed" errors and partially-persisted records.
    await stopBackground();
    stopPriceFeed();
    // Stop channels first so outbound bus drains naturally; then halt bus loops.
    // Await the channel stop so the ordering the comment promises actually holds —
    // dispatcher.stop() runs synchronously and would otherwise race the channel stops.
    await channelManager.stopAllChannels().catch(() => {});
    dispatcher.stop();
    cronService.stop();
    await chartRenderer.close().catch(() => {});
    app.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
