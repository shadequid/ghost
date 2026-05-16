import { Api } from "grammy";
import { redactToken } from "../../helpers/redact.js";
import { ChannelId } from "../types.js";
import { TelegramChannel } from "./index.js";
import { TelegramSetupError, type TelegramSetupErrorCode } from "../../gateway/channel-errors.js";
import type {
  ChannelPlugin,
  ActivateCtx,
  SetupCtx,
  SetupResult,
  StatusCtx,
  StatusResult,
  RemoveCtx,
  RemoveResult,
  ApprovalParams,
} from "../types.js";
import type { BaseChannel } from "../base.js";

/** Heuristic classifier — maps raw grammY / fetch error strings to a stable
 *  TelegramSetupErrorCode. Lives here so telegram-specific lexicon stays in
 *  the telegram plugin package. */
export function classifyTelegramError(raw: string): TelegramSetupErrorCode {
  const lower = raw.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("401")) return "telegram_unauthorized";
  if (lower.includes("invalid token") || lower.includes("token rejected")) return "telegram_invalid_token";
  if (
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("unreachable")
  ) {
    return "telegram_unreachable";
  }
  return "telegram_unknown";
}

export const TOKEN_KEY = `${ChannelId.Telegram}_token`;
const PAIRING_APPROVED_MESSAGE = "✅ Ghost access approved. Send a message to start chatting.";

export interface ProbeResult {
  ok: boolean;
  username?: string;
  error?: string;
}

export class TelegramPlugin implements ChannelPlugin {
  readonly id = ChannelId.Telegram;
  readonly label = "Telegram";
  readonly description = "Chat with Ghost from your phone";

  async setup(ctx: SetupCtx): Promise<SetupResult> {
    try {
      const probed = await this.probe(ctx.token);
      if (!probed.ok) {
        const rawMsg = probed.error ?? "unknown error";
        const safeMsg = redactToken(rawMsg, ctx.token);
        throw new TelegramSetupError(classifyTelegramError(safeMsg), safeMsg);
      }
      await ctx.credentials.set(TOKEN_KEY, ctx.token);
      return {
        summary: `Telegram connected as @${probed.username}. DM @${probed.username} on Telegram — the bot will reply with a pairing code.`,
      };
    } catch (err) {
      if (err instanceof TelegramSetupError) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      const safeMsg = redactToken(raw, ctx.token);
      throw new TelegramSetupError(classifyTelegramError(safeMsg), safeMsg);
    }
  }

  async status(ctx: StatusCtx): Promise<StatusResult> {
    const tokenPresent = await ctx.credentials.has(TOKEN_KEY);

    if (!tokenPresent) {
      return {
        enabled: false,
        healthy: false,
        summary: "not configured",
        detail: { tokenPresent: false },
      };
    }

    if (!ctx.probe) {
      return {
        enabled: true,
        healthy: true,
        summary: "connected (pass probe:true for bot details)",
        detail: { tokenPresent: true },
      };
    }

    const token = await ctx.credentials.get(TOKEN_KEY);
    const probed = token
      ? await this.probe(token)
      : { ok: false as const, error: "token missing" };

    if (!probed.ok) {
      return {
        enabled: true,
        healthy: false,
        summary: `error — ${probed.error}`,
        detail: { tokenPresent: true },
        error: probed.error,
      };
    }

    return {
      enabled: true,
      healthy: true,
      summary: `connected as @${probed.username}`,
      detail: { tokenPresent: true, bot: probed.username },
    };
  }

  async remove(ctx: RemoveCtx): Promise<RemoveResult> {
    await ctx.credentials.delete(TOKEN_KEY);
    ctx.pairingStore.clearRequests(ChannelId.Telegram);
    ctx.pairingStore.setAllowlist(ChannelId.Telegram, []);
    return { summary: "Telegram disabled and token removed." };
  }

  async activate(ctx: ActivateCtx): Promise<BaseChannel> {
    const token = await ctx.credentials.get(TOKEN_KEY);
    if (!token) {
      throw new TelegramSetupError("telegram_unauthorized", "telegram token not configured");
    }
    return new TelegramChannel(
      ctx.config.telegram,
      token,
      ctx.bus,
      ctx.logger.child({ module: ChannelId.Telegram }),
      ctx.eventBus,
      ctx.approvalManager,
      ctx.pairingStore,
      ctx.commandServices,
      ctx.pairingService,
      ctx.chartRenderer,
    );
  }

  async notifyApproval(params: ApprovalParams): Promise<void> {
    const token = await params.credentials.get(TOKEN_KEY);
    if (!token) throw new Error("telegram token not configured");
    await this.sendMessage(token, params.id, PAIRING_APPROVED_MESSAGE);
  }

  private async probe(token: string): Promise<ProbeResult> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("getMe timed out")), 3000),
    );
    try {
      const me = await Promise.race([new Api(token).getMe(), timeout]);
      return me.username
        ? { ok: true, username: me.username }
        : { ok: false, error: "getMe returned no username" };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, error: redactToken(raw, token) };
    }
  }

  private async sendMessage(token: string, chatId: string, text: string): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("sendMessage timed out")), 5000),
    );
    try {
      await Promise.race([new Api(token).sendMessage(chatId, text), timeout]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(redactToken(raw, token));
    }
  }
}

export const telegramPlugin: ChannelPlugin = new TelegramPlugin();
