import type { ApprovalPreview, ApprovalDecision } from "../gateway/approval.js";

export interface ApprovalOrigin {
  channel: string;   // "web" | "telegram" | "cli"
  chatId: string;
}

export interface TradingApprovalRequestedEvent {
  type: "trading.approval.requested";
  payload: {
    approvalId: string;
    sessionKey: string;
    preview: ApprovalPreview;
    createdAtMs: number;
    preText: string;
    origin: ApprovalOrigin | null;  // null → broadcast to every active channel
  };
}

export interface TradingApprovalResolvedEvent {
  type: "trading.approval.resolved";
  payload: {
    approvalId: string;
    decision: ApprovalDecision;
    ts: number;
  };
}

export const ApprovalEvents = {
  tradingRequested: (p: TradingApprovalRequestedEvent["payload"]): TradingApprovalRequestedEvent =>
    ({ type: "trading.approval.requested", payload: p }),
  tradingResolved: (p: TradingApprovalResolvedEvent["payload"]): TradingApprovalResolvedEvent =>
    ({ type: "trading.approval.resolved", payload: p }),
} as const;

export type ApprovalEvent = TradingApprovalRequestedEvent | TradingApprovalResolvedEvent;
