/**
 * WS JSON-RPC methods for managing channels from the web dashboard.
 *
 * Setup orchestration (plugin.setup → save config → construct channel →
 * addChannel + startChannel) lives here — ChannelManager is now a thin
 * instance tracker with no knowledge of config persistence.
 */

import type { MethodHandler } from "./method-registry.js";
import type { CredentialStore } from "../config/credentials.js";
import type { PairingStore } from "../pairing/store.js";
import type { PairingService as PairingOrchestrator } from "../pairing/service.js";
import type { MessageDispatcher } from "../channels/dispatcher.js";
import type { MessageBus } from "../bus/queue.js";
import type { EventBus } from "../bus/events.js";
import type { ApprovalManager } from "./approval.js";
import type { Config } from "../config/schema.js";
import type { Logger } from "pino";
import { CHANNEL_PLUGINS } from "../channels/index.js";
import type { CommandServices } from "../channels/telegram/index.js";
import { TelegramSetupError } from "./channel-errors.js";
import { redactToken } from "../helpers/redact.js";
import { ChannelManager } from "../channels/manager.js";
import { ChannelEvents } from "../events/pairing-events.js";
import { ChannelId } from "../channels/types.js";

export interface ChannelsMethodsDeps {
  config: Config;
  credentials: CredentialStore;
  pairingStore: PairingStore;
  pairingService: PairingOrchestrator;
  dispatcher: MessageDispatcher;
  bus: MessageBus;
  eventBus: EventBus;
  approvalManager: ApprovalManager;
  commandServices: CommandServices;
  /**
   * Shared ChannelManager instance from runtime. Must be the same instance
   * used by daemon boot so that `runtime.channelManager.isActive(id)` stays
   * in sync with gateway-initiated setup/remove.
   */
  manager: ChannelManager;
  logger: Logger;
}

export function registerChannelsMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: ChannelsMethodsDeps,
): void {
  const log = deps.logger.child({ module: "gateway-channels" });

  // Use the shared runtime ChannelManager — do NOT construct a new one here.
  // A local instance diverges from runtime.channelManager, breaking isActive()
  // for cron/proactive/liquidation dispatch.
  const manager = deps.manager;

  register("channels.list", async () => {
    const summaries = await Promise.all(CHANNEL_PLUGINS.map(async (p) => {
      const running = manager.getChannel(p.id)?.isRunning ?? false;
      const credKey = p.id === ChannelId.Telegram ? `${ChannelId.Telegram}_token` : undefined;
      const hasCredential = credKey ? await deps.credentials.has(credKey) : false;
      return {
        id: p.id,
        label: p.label,
        description: p.description,
        enabled: running || hasCredential,
        running,
      };
    }));
    return { channels: summaries };
  });

  register("channels.status", async (_ctx, payload) => {
    const p = (payload ?? {}) as { probe?: boolean };
    const id = resolveChannelId(payload);
    const plugin = requirePlugin(id);
    const result = await plugin.status({
      credentials: deps.credentials,
      probe: Boolean(p.probe),
    });
    const running = manager.getChannel(id)?.isRunning ?? false;
    const pendingCount = deps.pairingStore.listRequests(id).length;
    return { ...result, running, pendingCount };
  });

  register("channels.setup", async (_ctx, payload) => {
    const p = (payload ?? {}) as { token?: unknown };
    const id = resolveChannelId(payload);
    const plugin = requirePlugin(id);

    if (typeof p.token !== "string" || p.token.trim().length === 0) {
      throw new Error("token is required");
    }
    const token = p.token.trim();

    try {
      const { summary } = await manager.activate(plugin, {
        config: deps.config,
        credentials: deps.credentials,
        bus: deps.bus,
        eventBus: deps.eventBus,
        approvalManager: deps.approvalManager,
        pairingStore: deps.pairingStore,
        pairingService: deps.pairingService,
        commandServices: deps.commandServices,
        logger: log,
        token,
      });

      deps.dispatcher.ensureLoopsRunning();
      deps.eventBus.publish(ChannelEvents.stateChanged({ channel: plugin.id, state: "connected" }));

      return { ok: true as const, summary };
    } catch (err) {
      if (err instanceof TelegramSetupError) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      const safeMsg = redactToken(raw, token);
      // Re-wrap any remaining untyped errors for wire compatibility.
      throw new TelegramSetupError("telegram_unknown", safeMsg);
    }
  });

  register("channels.remove", async (_ctx, payload) => {
    const id = resolveChannelId(payload);
    const plugin = CHANNEL_PLUGINS.find((pl) => pl.id === id);
    if (!plugin) {
      return { ok: false as const, error: `no plugin registered for channel: ${id}`, code: "not_found" };
    }

    // Wrap in per-id lock to serialize against concurrent setup calls.
    // Use removeChannelLocked (no lock re-acquisition) to avoid deadlocking
    // AsyncKeyLock, which is not re-entrant.
    return manager.withLock(id, async () => {
      const result = await plugin.remove({
        credentials: deps.credentials,
        pairingStore: deps.pairingStore,
      });

      await manager.removeChannelLocked(id);

      deps.eventBus.publish(ChannelEvents.stateChanged({ channel: id, state: "disconnected" }));
      return { ok: true as const, summary: result.summary };
    });
  });

  register("channels.pairing.list", async (_ctx, payload) => {
    const id = resolveChannelId(payload);
    return {
      requests: deps.pairingService.listRequests(id).map((r) => ({
        code: r.code, senderId: r.senderId, username: r.username,
        createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, expiresAt: r.expiresAt,
      })),
    };
  });

  register("channels.pairing.approve", async (_ctx, payload) => {
    const p = (payload ?? {}) as { id?: unknown; code?: unknown; notify?: unknown };
    const id = resolveChannelId(payload);
    if (typeof p.code !== "string" || p.code.trim().length === 0) {
      throw new Error("code is required");
    }
    const code = p.code.trim();
    const notify = p.notify !== false; // default true
    const plugin = requirePlugin(id);

    return await manager.withLock(id, async () => {
      const result = deps.pairingService.approveRequest(id, code);
      if (!result.approved) {
        return { ok: false, reason: "not_found" as const };
      }

      let notifyError: string | null = null;
      if (notify) {
        try {
          await plugin.notifyApproval({
            id: result.identity!,
            credentials: deps.credentials,
          });
        } catch (err) {
          notifyError = err instanceof Error ? err.message : String(err);
          log.warn({ err, channel: id, code }, "approval notify failed");
        }
      }

      return {
        ok: true,
        identity: result.identity,
        notified: notify && notifyError === null,
        notifyError,
      };
    });
  });

  register("channels.allowlist.list", async (_ctx, payload) => {
    const id = resolveChannelId(payload);
    return {
      entries: deps.pairingStore.listAllowlist(id).map((e) => ({
        identity: e.identity, identityKind: e.identityKind,
        displayName: e.displayName, addedAt: e.addedAt,
      })),
    };
  });

  register("channels.allowlist.remove", async (_ctx, payload) => {
    const p = (payload ?? {}) as { id?: unknown; identity?: unknown };
    const id = resolveChannelId(payload);
    if (typeof p.identity !== "string" || p.identity.trim().length === 0) {
      throw new Error("identity is required");
    }
    const identity = p.identity.trim();
    const ok = deps.pairingService.revoke(id, identity);
    return { ok };
  });
}

/**
 * Read channel id from payload. Defaults to the only registered plugin when
 * exactly one channel is configured (backward-compat for Telegram-only
 * deployments). When multiple plugins are registered, an explicit id is
 * required — omitting it would silently route to the wrong channel.
 */
function resolveChannelId(payload: unknown): string {
  const p = (payload ?? {}) as { id?: unknown };
  const explicit = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : null;
  if (!explicit) {
    if (CHANNEL_PLUGINS.length > 1) {
      throw new Error("channel id is required when multiple channels are configured");
    }
    return CHANNEL_PLUGINS[0].id;
  }
  requirePlugin(explicit);
  return explicit;
}

function requirePlugin(id: string): typeof CHANNEL_PLUGINS[number] {
  const plugin = CHANNEL_PLUGINS.find((p) => p.id === id);
  if (!plugin) throw new Error(`Unknown channel id: ${id}`);
  return plugin;
}

