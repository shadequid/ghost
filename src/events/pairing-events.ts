export interface PairingRequestCreatedEvent {
  type: "pairing.request.created";
  payload: {
    channel: string;
    code: string;
    senderId: string;
    username: string | null;
    createdAt: number;
    expiresAt: number;
  };
}

export interface PairingRequestApprovedEvent {
  type: "pairing.request.approved";
  payload: {
    channel: string;
    code: string;
    senderId: string;
    username: string | null;
  };
}

export interface PairingRequestRemovedEvent {
  type: "pairing.request.removed";
  payload: {
    channel: string;
    code: string;
    reason: "rejected" | "expired";
  };
}

export interface PairingAllowlistRemovedEvent {
  type: "pairing.allowlist.removed";
  payload: {
    channel: string;
    identity: string;
  };
}

export interface ChannelStateChangedEvent {
  type: "channel.state.changed";
  payload: {
    channel: string;
    state: "connected" | "disconnected";
    bot?: string | null;
  };
}

export const PairingEvents = {
  created: (p: PairingRequestCreatedEvent["payload"]): PairingRequestCreatedEvent =>
    ({ type: "pairing.request.created", payload: p }),
  approved: (p: PairingRequestApprovedEvent["payload"]): PairingRequestApprovedEvent =>
    ({ type: "pairing.request.approved", payload: p }),
  removed: (p: PairingRequestRemovedEvent["payload"]): PairingRequestRemovedEvent =>
    ({ type: "pairing.request.removed", payload: p }),
  allowlistRemoved: (p: PairingAllowlistRemovedEvent["payload"]): PairingAllowlistRemovedEvent =>
    ({ type: "pairing.allowlist.removed", payload: p }),
} as const;

export const ChannelEvents = {
  stateChanged: (p: ChannelStateChangedEvent["payload"]): ChannelStateChangedEvent =>
    ({ type: "channel.state.changed", payload: p }),
} as const;

export type PairingEvent =
  | PairingRequestCreatedEvent
  | PairingRequestApprovedEvent
  | PairingRequestRemovedEvent
  | PairingAllowlistRemovedEvent;

export type ChannelEvent = ChannelStateChangedEvent;
