/**
 * Session info tool — exposes session metadata for skills like briefing and proactive-advisor.
 * Lets the agent check user-absence duration without orchestrator hacks.
 *
 * Uses session.lastActiveAt (user messages only) rather than session.updatedAt
 * so background writes (cron, proactive assistant turns, alert fan-out) do not
 * reset the idle clock.
 */

import { Type } from "@sinclair/typebox";
import type { SessionManager } from "../../session/manager.js";
import { MAIN_SESSION_KEY } from "../../session/session.js";
import { textResult } from "../../helpers/result.js";
import type { AnyAgentTool } from "./types.js";

export function createSessionInfoTool(sessionManager: SessionManager): AnyAgentTool {
  return {
    name: "ghost_session_info",
    label: "Session Info",
    description:
      "Returns hoursSinceLastActive (hours since user's last message; null if user has never messaged in this session) and messageCount. " +
      "Call at the start of proactive scans to tune emission bar, and before briefings to detect long absences. " +
      "hoursSinceLastActive ignores agent/tool messages — it reflects when the user themselves last interacted. " +
      "messageCount is the total number of persisted messages across all roles (user, assistant, tool, toolResult) — " +
      "a different semantic from hoursSinceLastActive which is user-only.",
    parameters: Type.Object({}),
    execute() {
      const session = sessionManager.getOrCreate(MAIN_SESSION_KEY);
      const now = Date.now();

      const hoursSinceLastActive =
        session.lastActiveAt !== null
          ? Math.round((now - session.lastActiveAt.getTime()) / (60 * 60 * 1000))
          : null;

      const messageCount = session.messages.length;

      return Promise.resolve(
        textResult(
          JSON.stringify({
            hoursSinceLastActive,
            messageCount,
          }),
        ),
      );
    },
  };
}
