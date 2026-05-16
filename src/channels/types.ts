import type { CredentialStore } from "../config/credentials.js";
import type { PairingStore } from "../pairing/store.js";
import type { Logger } from "pino";
import type { MessageBus } from "../bus/queue.js";
import type { EventBus } from "../bus/events.js";
import type { ApprovalManager } from "../gateway/approval.js";
import type { PairingService } from "../pairing/service.js";
import type { Config } from "../config/schema.js";
import type { BaseChannel } from "./base.js";
import type { CommandServices } from "./telegram/commands/types.js";
import type { ChartRenderer } from "./telegram/chart-renderer.js";

/** Canonical channel identifiers. */
export const ChannelId = {
  Telegram: "telegram",
} as const;

export type ChannelId = (typeof ChannelId)[keyof typeof ChannelId];

export const CHANNEL_IDS = Object.values(ChannelId) as readonly ChannelId[];

/**
 * Generic contract for converting raw LLM markdown into a channel's wire
 * format. Channel-specific concerns (segmenting, structured entities) stay
 * on the concrete class, NOT here — Slack/Discord adapters should not be
 * forced to implement methods that don't fit their model (Block Kit, embeds).
 */
export interface ChannelFormatter {
  format(raw: string): string;
}

/**
 * Runtime services passed to `ChannelPlugin.activate()`. Carries everything
 * a channel needs to construct itself. The `token` field is only present for
 * first-time setup (from the RPC path); daemon boot sets it from credentials.
 */
export interface ActivateCtx {
  config: Config;
  credentials: CredentialStore;
  bus: MessageBus;
  eventBus: EventBus;
  approvalManager: ApprovalManager;
  pairingStore: PairingStore;
  pairingService: PairingService;
  /** Shared service bag (trading, wallet, news, alerts, price). */
  commandServices: CommandServices;
  logger: Logger;
  /** Bot token — present on RPC setup path, absent on daemon resume path. */
  token?: string;
  /** Optional: chart screenshot renderer. Absent in test environments. */
  chartRenderer?: ChartRenderer;
}

export interface SetupCtx {
  credentials: CredentialStore;
  /** Bot token, from web-UI `channels.setup` RPC payload. */
  token: string;
}

export interface SetupResult {
  summary: string;
}

export interface StatusCtx {
  credentials: CredentialStore;
  /** Hit the channel API (e.g. Telegram getMe) to verify token + fetch bot username. */
  probe: boolean;
}

export interface StatusResult {
  enabled: boolean;
  healthy: boolean;
  summary: string;
  detail: Record<string, unknown>;
  error?: string;
}

export interface RemoveCtx {
  credentials: CredentialStore;
  pairingStore: PairingStore;
}

export interface RemoveResult {
  summary: string;
}

export interface ApprovalParams {
  /** Channel-native id of the approved user (Telegram chat id). */
  id: string;
  credentials: CredentialStore;
}

/**
 * Every channel implements this. Class-based so concrete plugins can hold
 * private helpers (token resolution, HTTP probe) inside the class boundary.
 *
 * Setup is exposed from two entry points and ends in the same place:
 *   - Web dashboard → `channels.setup` RPC → `plugin.setup({credentials, token})`
 *   - CLI `ghost channel setup <id> [--token=...]` → direct call into the
 *     same `plugin.setup` (no daemon RPC; daemon picks up the new token on
 *     next restart).
 */
export interface ChannelPlugin {
  readonly id: ChannelId;
  readonly label: string;
  readonly description: string;

  setup(ctx: SetupCtx): Promise<SetupResult>;
  status(ctx: StatusCtx): Promise<StatusResult>;
  remove(ctx: RemoveCtx): Promise<RemoveResult>;
  notifyApproval(params: ApprovalParams): Promise<void>;
  /**
   * Construct and return the live channel instance. Called by
   * `ChannelManager.activate()` after credentials are written.
   * Async because token resolution may require a credentials read.
   */
  activate(ctx: ActivateCtx): Promise<BaseChannel>;
}
