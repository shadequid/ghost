/**
 * Telemetry emitted for every observer tick — both event-count = 0 ("skip")
 * and event-bearing ticks. Used by /diagnostics surfaces and tests.
 */
export interface ObserverTickEvent {
  type: "observer.tick";
  payload: {
    /** Number of typed events emitted by the diff stage this tick. */
    eventCount: number;
    /** `skip` when no events, `fire`/`silent` when the judge ran. */
    decision: "skip" | "fire" | "silent";
    primaryEventType?: string | null;
    primarySymbol?: string | null;
    reason?: string | null;
    ts: number;
  };
}
