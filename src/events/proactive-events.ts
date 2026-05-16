/** Telemetry event for every proactive scan decision (fire OR silent). */
export interface ProactiveDecisionEvent {
  type: "proactive.decision";
  payload: {
    decision: "fire" | "silent";
    topic: string | null;
    symbol: string | null;
    reason: string | null;
    ts: number;
  };
}
