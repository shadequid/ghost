export interface ClientConnectedEvent {
  type: "client.connected";
  payload: { clients: number };
}

export interface ClientDisconnectedEvent {
  type: "client.disconnected";
  payload: { clients: number };
}

/**
 * Published when a scheduled (proactive) agent turn produces a response that
 * should appear as an assistant message in the web UI — without a preceding
 * user message. `source` identifies the job name for optional badge display.
 *
 * `id` is a stable identifier shared with the corresponding session-log
 * assistant message so that a client which receives both the live event
 * and a `chat.history` reload (e.g. after an F5 mid-flight) can dedupe.
 * `useChatEvents.ts:283` reads this field; legacy callers that don't set
 * it fall back to a random UUID, accepting the rare double-render risk.
 */
export interface ProactiveDeliveryEvent {
  type: "chat.proactive";
  payload: { id?: string; source: string; content: string; ts: number };
}

export const ClientEvents = {
  connected: (p: ClientConnectedEvent["payload"]): ClientConnectedEvent =>
    ({ type: "client.connected", payload: p }),
  disconnected: (p: ClientDisconnectedEvent["payload"]): ClientDisconnectedEvent =>
    ({ type: "client.disconnected", payload: p }),
  proactive: (p: ProactiveDeliveryEvent["payload"]): ProactiveDeliveryEvent =>
    ({ type: "chat.proactive", payload: p }),
} as const;

export type ClientEvent = ClientConnectedEvent | ClientDisconnectedEvent | ProactiveDeliveryEvent;
