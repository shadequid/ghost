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

export interface CronDeliveryDeps {
  runner: Runner;
  contextBuilder: ContextBuilder;
  bus: MessageBus;
  eventBus: EventBus;
  tools: ToolRegistry;
  channelManager: ChannelManager;
  pairingStore: PairingStore;
  logger: Logger;
}

export function createCronDeliveryHandler(
  deps: CronDeliveryDeps,
): (job: CronJob) => Promise<string | null> {
  return async (job: CronJob): Promise<string | null> => {
    const { runner, contextBuilder, bus, eventBus, tools, channelManager, pairingStore, logger } = deps;

    const cronTool = tools.get("cron");
    if (isCronAware(cronTool)) {
      cronTool.enterCron();
    }

    try {
      const activeChannels = getOutboundChannels({ channelManager, pairingStore, logger });

      const text = (await runner.call({
        systemPrompt: contextBuilder.buildFullPrompt("internal", `cron-${job.name}`),
        message: `${REMINDER_NOTE_PREFIX}\n\nTask: ${job.payload.message}`,
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
