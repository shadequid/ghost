export type WalletChangedAction =
  | "connect" | "remove" | "trading-enabled"
  | "set-default" | "disconnect-source";

export type WalletChangedPayload =
  | { action: "connect" | "remove" | "trading-enabled" | "set-default"; address: string }
  | { action: "disconnect-source"; source: string; removed: string[] };

export interface WalletChangedEvent {
  type: "wallet.changed";
  payload: WalletChangedPayload;
}

export const WalletEvents = {
  changed: (p: WalletChangedPayload): WalletChangedEvent =>
    ({ type: "wallet.changed", payload: p }),
} as const;

export type WalletEvent = WalletChangedEvent;
