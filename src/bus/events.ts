/**
 * EventBus — sync pub/sub for server-side state notifications.
 *
 * Differs from MessageBus (src/bus/queue.ts), which is a 1:1 work queue
 * between channels and the agent. EventBus is 1:N fan-out for cross-cutting
 * notifications (wallet changed, trading approval, tool approval, etc.).
 *
 * Publish is sync and non-throwing: each subscriber is called in a try/catch
 * so one bad subscriber cannot break another or the publisher.
 */

import type { Logger } from "pino";
import type { GhostEvent } from "../events/index.js";

export class EventBus {
  private readonly subs = new Set<(e: GhostEvent) => void>();

  constructor(private readonly logger: Logger) {}

  publish(e: GhostEvent): void {
    for (const fn of this.subs) {
      try { fn(e); }
      catch (err) { this.logger.warn({ err, type: e.type }, "subscriber threw"); }
    }
  }

  subscribe(fn: (e: GhostEvent) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }
}
