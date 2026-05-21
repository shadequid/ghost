/**
 * X/Twitter follow tool — authenticate, follow, unfollow, list tracked accounts.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { XFollowService } from "../../services/x-follows.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";

export function createXFollowTools(xFollows: XFollowService): AgentTool[] {
  return [
    defineTool({
      name: "ghost_x_follow",
      label: "X Follow",
      description:
        "Manage X/Twitter feed. Actions: " +
        "'auth' (set X session cookies to enable tweet fetching), " +
        "'follow' (add account to track), " +
        "'unfollow' (stop tracking), " +
        "'list' (show tracked accounts).",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("auth"),
          Type.Literal("follow"),
          Type.Literal("unfollow"),
          Type.Literal("list"),
        ]),
        username: Type.Optional(Type.String({ description: "X/Twitter username (with or without @)" })),
        auth_token: Type.Optional(Type.String({ description: "X session cookie: auth_token" })),
        ct0: Type.Optional(Type.String({ description: "X session cookie: ct0" })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        try {
          const p = params as { action: string; username?: string; auth_token?: string; ct0?: string };

          switch (p.action) {
            case "auth": {
              if (!p.auth_token || !p.ct0) {
                return errorResult(
                  "Provide auth_token and ct0 cookies.\n\n" +
                    "Steps:\n" +
                    "1. Open x.com in Chrome and log in\n" +
                    "2. Press F12 → Application tab → Cookies → https://x.com\n" +
                    "3. Copy the values of `auth_token` and `ct0`",
                );
              }
              const user = await xFollows.auth(p.auth_token, p.ct0);
              const label = user.screenName ? `Authenticated as ${user.name} (@${user.screenName})` : "X authentication successful.";
              return textResult(label);
            }

            case "follow": {
              if (!p.username) return errorResult("Provide a username to follow.");
              if (!(await xFollows.hasAuth())) {
                return errorResult(
                  "X authentication required before following accounts. " +
                    "Use the 'auth' action first with your auth_token and ct0 cookies.",
                );
              }
              const clean = p.username.replace(/^@/, "").toLowerCase().trim();
              const { added, notFound, displayName } = await xFollows.follow(clean);
              if (notFound) return errorResult(`X account @${clean} not found.`);
              if (!added) return textResult(`Already following @${clean}.`);
              const label = displayName ? `${displayName} (@${clean})` : `@${clean}`;
              return textResult(`Now following ${label}. Tweets will appear in your news feed within a few minutes.`);
            }

            case "unfollow": {
              if (!p.username) return errorResult("Provide a username to unfollow.");
              const clean = p.username.replace(/^@/, "").toLowerCase().trim();
              const removed = xFollows.unfollow(clean);
              if (!removed) return textResult(`Not following @${clean}.`);
              return textResult(`Unfollowed @${clean}.`);
            }

            case "list": {
              const follows = xFollows.list();
              if (follows.length === 0) return textResult("Not following any X accounts.");
              const hasAuth = await xFollows.hasAuth();
              const lines = ["X Accounts", "─".repeat(30)];
              for (const f of follows) {
                const label = f.displayName ? `${f.displayName} (@${f.username})` : `@${f.username}`;
                lines.push(label);
              }
              lines.push("", `${follows.length} account(s) tracked`);
              if (!hasAuth) lines.push("⚠ X auth not configured — tweets will not be fetched");
              return textResult(lines.join("\n"));
            }

            default:
              return errorResult(`Unknown action "${p.action}". Use: auth, follow, unfollow, list.`);
          }
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    }),
  ];
}
