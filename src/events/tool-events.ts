import type { ApprovalPreview, ApprovalDecision } from "../gateway/approval.js";

export interface ToolApprovalRequestedEvent {
  type: "tool.approval.requested";
  payload: {
    approvalId: string;
    preview: ApprovalPreview;
    createdAtMs: number;
  };
}

export interface ToolApprovalResolvedEvent {
  type: "tool.approval.resolved";
  payload: {
    approvalId: string;
    decision: ApprovalDecision;
    ts: number;
  };
}

export interface McpToolResultEvent {
  type: "mcp.tool_result";
  payload: {
    toolCallId: string;
    name: string;
    success: boolean;
    durationSecs?: number;
  };
}

export const ToolEvents = {
  approvalRequested: (p: ToolApprovalRequestedEvent["payload"]): ToolApprovalRequestedEvent =>
    ({ type: "tool.approval.requested", payload: p }),
  approvalResolved: (p: ToolApprovalResolvedEvent["payload"]): ToolApprovalResolvedEvent =>
    ({ type: "tool.approval.resolved", payload: p }),
  mcpResult: (p: McpToolResultEvent["payload"]): McpToolResultEvent =>
    ({ type: "mcp.tool_result", payload: p }),
} as const;

export type ToolEvent =
  | ToolApprovalRequestedEvent
  | ToolApprovalResolvedEvent
  | McpToolResultEvent;
