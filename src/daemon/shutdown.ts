/**
 * Process exit coordination for the Ghost daemon — signal handlers, crash
 * handlers, and the exit-code contract that lets the service supervisor
 * tell "operator stop" apart from "JS crash, restart please".
 *
 * Exit-code contract:
 *   0   clean shutdown (SIGINT / SIGTERM)        → supervisor stays down
 *   1   reserved for OS-level termination        → supervisor stays down
 *       (taskkill /F, OOM kill, etc. — user/system intent honoured)
 *   100 uncaughtException                        → supervisor restarts
 *   101 unhandledRejection                       → supervisor restarts
 *
 * Without the 100/101 split, `taskkill /F` and a JS crash would both surface
 * as exit 1 and the supervisor could not tell whether to relaunch.
 */

import type { Logger } from "pino";
import type { Runtime } from "../runtime.js";

export const EXIT_UNCAUGHT_EXCEPTION = 100;
export const EXIT_UNHANDLED_REJECTION = 101;

/**
 * Single "winner takes the exit code" guard. Crash handler and signal
 * handler both call `process.exit(...)` with different codes (100/101 vs 0);
 * whichever wins sets the code the supervisor sees. The first caller to
 * `claimExit` owns the exit — the loser must skip its `process.exit()` call.
 */
let exitCodeWinner: number | null = null;
export function claimExit(code: number): boolean {
  if (exitCodeWinner !== null) return false;
  exitCodeWinner = code;
  return true;
}

let crashHandlersInstalled = false;
let crashCleanup: (() => Promise<void>) | null = null;

/**
 * Register a best-effort cleanup callback to run before the crash handler
 * exits non-zero. Called by `installShutdownHandlers` once the runtime is
 * fully wired. The cleanup runs under a 3-second watchdog so a hung
 * `db.close()` or stuck channel teardown cannot prevent the exit — the
 * supervisor relaunch path is more important than a clean drain.
 */
export function setCrashCleanup(cleanup: () => Promise<void>): void {
  crashCleanup = cleanup;
}

export function installCrashHandlers(logger: Logger): void {
  if (crashHandlersInstalled) return;
  crashHandlersInstalled = true;

  const handleFatal = async (kind: string, exitCode: number, payload: Record<string, unknown>) => {
    logger.fatal({ module: "daemon", exitCode, ...payload }, `${kind} — exiting for supervisor restart`);
    if (crashCleanup) {
      try {
        await Promise.race([
          crashCleanup(),
          new Promise<void>((resolve) => setTimeout(resolve, 3000).unref()),
        ]);
      } catch (cleanupErr) {
        logger.error({ module: "daemon", cleanupErr }, "crash cleanup threw — proceeding to exit");
      }
    }
    if (claimExit(exitCode)) {
      process.exit(exitCode);
    }
  };

  process.on("uncaughtException", (err) => {
    void handleFatal("uncaughtException", EXIT_UNCAUGHT_EXCEPTION, { err });
  });
  process.on("unhandledRejection", (reason) => {
    void handleFatal("unhandledRejection", EXIT_UNHANDLED_REJECTION, { reason });
  });
}

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
 * Install SIGINT and SIGTERM handlers and return the cleanup callback so
 * crash handlers can reuse the same teardown without exiting via this path.
 *
 * Signal handler invokes cleanup then `process.exit(0)`. Crash handler
 * invokes cleanup directly and exits non-zero on its own — so callers can
 * tell "operator stop" from "supervisor relaunch needed" by exit code.
 *
 * The cleanup is async so it can await BackgroundJobRunner.stop() before
 * tearing down the DB — preventing "database is closed" errors from jobs
 * that are still writing when the signal arrives.
 *
 * Returns the cleanup function so the crash handler can call it under its
 * own watchdog before `process.exit(1)`.
 */
export function installShutdownHandlers(deps: ShutdownDeps): () => Promise<void> {
  const {
    runtime,
    gatewayHandle,
    unsubscribeBus,
    stopBackground,
  } = deps;
  const { db, dispatcher, channelManager, cronService, chartRenderer } = runtime;
  const { stopPriceFeed, app } = gatewayHandle;

  let shuttingDown = false;

  const cleanup = async () => {
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
  };

  const shutdownOnSignal = async () => {
    // Cleanup must NOT leak its throw into the unhandledRejection handler —
    // the crash handler would then claim exit 101 and the supervisor would
    // restart even though the user pressed Ctrl+C. Try/finally guarantees we
    // attempt the exit-code claim regardless of cleanup success. Operator
    // intent (stop) trumps cleanup completeness.
    try {
      await cleanup();
    } finally {
      if (claimExit(0)) {
        process.exit(0);
      }
    }
  };

  process.on("SIGINT", shutdownOnSignal);
  process.on("SIGTERM", shutdownOnSignal);

  return cleanup;
}
