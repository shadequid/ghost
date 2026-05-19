/** Cron delivery handler — runs the agent and dispatches the response to outbound channels. */

import type { Logger } from "pino";
import type { CronJob } from "./types.js";
import type { Runner } from "../agent/runner.js";
import type { ContextBuilder } from "../agent/context-builder.js";
import type { MessageBus } from "../bus/queue.js";
import type { EventBus } from "../bus/events.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PairingStore } from "../pairing/store.js";
import type { ChannelManager } from "../channels/manager.js";
import type { SessionManager } from "../session/manager.js";
import { MAIN_SESSION_KEY } from "../session/session.js";
import { getOutboundChannels, dispatchOutbound } from "../channels/index.js";
import { isCronAware } from "../tools/context-aware.js";

/**
 * Prefixed before every cron task message. Disciplines the agent response shape:
 * speak naturally in the user's language, no meta-commentary, no status chatter.
 */
const REMINDER_NOTE_PREFIX =
  "The scheduled time has arrived. Deliver this task to the user now " +
  "as a brief, natural message in their language. Speak directly — " +
  "no narration, no status chatter like \"Done\" or \"Reminded\", " +
  "no meta-reasoning about the task itself.";

/**
 * How many recent user messages to surface as a language-reference block.
 * Runner clears state.messages on every cron call so without an explicit
 * anchor the model has zero chat context and defaults to the English task
 * prompt — same mechanism event-judge already uses to keep TP-fill
 * notifications in the user's language. Three lines is enough to disambiguate
 * vi/en/zh without bloating the prompt.
 */
const LANG_REFERENCE_MAX_MESSAGES = 3;

export interface CronDeliveryDeps {
  runner: Runner;
  contextBuilder: ContextBuilder;
  bus: MessageBus;
  eventBus: EventBus;
  tools: ToolRegistry;
  channelManager: ChannelManager;
  pairingStore: PairingStore;
  sessionManager: SessionManager;
  logger: Logger;
}

/**
 * Pull up to N most recent user-authored text snippets from the main session.
 * Tool calls, assistant turns, and synthetic markers are excluded — we only
 * want substance the user actually typed, since that is the language signal.
 *
 * `content` may be either a string (Orchestrator's inbound path appends user
 * messages as `{role:"user", content: "<text>"}`) or an array of content blocks
 * (some channel paths and pi-ai's canonical Message shape). Handle both so we
 * surface a language signal after restart, when the session was rehydrated from
 * JSONL where most user lines are string-form.
 *
 * Empty session returns an empty array; caller omits the reference block.
 */
function snapshotRecentUserMessages(
  sessionManager: SessionManager,
  limit: number,
): string[] {
  const session = sessionManager.getOrCreate(MAIN_SESSION_KEY);
  const out: string[] = [];
  for (const msg of session.messages) {
    const m = msg as { role?: string; content?: unknown };
    if (m.role !== "user") continue;
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<{ type?: string; text?: unknown }>) {
        if (block?.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out.slice(-limit);
}

export function createCronDeliveryHandler(
  deps: CronDeliveryDeps,
): (job: CronJob) => Promise<string | null> {
  return async (job: CronJob): Promise<string | null> => {
    const { runner, contextBuilder, bus, eventBus, tools, channelManager, pairingStore, sessionManager, logger } = deps;

    const cronTool = tools.get("cron");
    if (isCronAware(cronTool)) {
      cronTool.enterCron();
    }

    try {
      const activeChannels = getOutboundChannels({ channelManager, pairingStore, logger });

      // Language anchor: surface recent user messages verbatim so the model
      // can detect the trader's language. Without this, Runner.call clears
      // state.messages and the model only sees the English task prompt.
      const recentUser = snapshotRecentUserMessages(sessionManager, LANG_REFERENCE_MAX_MESSAGES);
      const langRefBlock = recentUser.length === 0
        ? ""
        : "Recent user messages (language reference only — do NOT reply to these, " +
          "use them only to match the trader's language and tone):\n" +
          recentUser.map((t) => `- ${t}`).join("\n") +
          "\n\n";

      const text = (await runner.call({
        systemPrompt: contextBuilder.buildFullPrompt("internal", `cron-${job.name}`),
        message: `${langRefBlock}${REMINDER_NOTE_PREFIX}\n\nTask: ${job.payload.message}`,
        persist: true,
      })).trim();

      if (!text) {
        logger.warn({ job: job.name }, "cron: empty response, skipping");
        return null;
      }

      await dispatchOutbound(activeChannels, text, {
        eventBus,
        bus,
        source: job.name,
        logger,
      });

      logger.info({ job: job.name, channels: activeChannels.length }, "cron: dispatched");
      return text;
    } finally {
      if (isCronAware(cronTool)) {
        cronTool.exitCron();
      }
    }
  };
}
