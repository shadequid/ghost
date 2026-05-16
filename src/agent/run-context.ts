import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call metadata propagated from the caller (e.g. Runner) to the
 * provider stream layer. Async-safe across await boundaries so concurrent
 * call chains never see each other's context.
 *
 * Currently used by the claude-cli provider to detect task-agent calls and
 * route them through the SDK with `persistSession: false`, preventing the
 * background-job session from clobbering the main user session.
 */
export interface AgentRunContext {
  kind: "task";
}

export const agentRunContext = new AsyncLocalStorage<AgentRunContext>();
