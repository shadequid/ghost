export * from "./wallet-events.js";
export * from "./approval-events.js";
export * from "./trading-events.js";
export * from "./tool-events.js";
export * from "./client-events.js";
export * from "./pairing-events.js";
export * from "./proactive-events.js";
export * from "./observer-events.js";

import type { WalletEvent } from "./wallet-events.js";
import type { ApprovalEvent } from "./approval-events.js";
import type { TradingEvent } from "./trading-events.js";
import type { ToolEvent } from "./tool-events.js";
import type { ClientEvent } from "./client-events.js";
import type { PairingEvent, ChannelEvent } from "./pairing-events.js";
import type { ProactiveDecisionEvent } from "./proactive-events.js";
import type { ObserverTickEvent } from "./observer-events.js";

export type GhostEvent =
  | WalletEvent
  | ApprovalEvent
  | TradingEvent
  | ToolEvent
  | ClientEvent
  | PairingEvent
  | ChannelEvent
  | ProactiveDecisionEvent
  | ObserverTickEvent;
