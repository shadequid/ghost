/**
 * Aware interfaces for tools that need orchestrator/scheduler-injected context.
 * A tool that implements OriginAware advertises "inject the current
 * channel/chatId into me before each prompt".
 *
 * Lifecycle contract:
 *   - Orchestrator sets origin per inbound message (channel + chatId).
 *   - Runner clears origin per call (passes "" / "") so background jobs do not
 *     inherit a prior chat session's routing context.
 */

export interface OriginAware {
  /** Bind the tool to the current inbound's channel/chatId. */
  setOrigin(channel: string, chatId: string): void;
}

export interface CronAware {
  /** Enter cron execution scope (e.g., disable nested scheduling). */
  enterCron(): void;
  /** Exit cron execution scope. Always pair with enterCron() in finally. */
  exitCron(): void;
}

export function isOriginAware(t: unknown): t is OriginAware {
  return typeof t === "object" && t !== null
    && typeof (t as OriginAware).setOrigin === "function";
}

export function isCronAware(t: unknown): t is CronAware {
  return typeof t === "object" && t !== null
    && typeof (t as CronAware).enterCron === "function"
    && typeof (t as CronAware).exitCron === "function";
}
