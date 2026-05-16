/**
 * Tracks live channel instances with a per-id mutex and start-race timeout.
 * Setup orchestration (config + credentials) lives in `gateway/channels.ts`.
 */

import type { Logger } from "pino";
import type { BaseChannel } from "./base.js";
import type { ChannelPlugin, ActivateCtx } from "./types.js";
import { ChannelSetupError } from "../gateway/channel-errors.js";
import { AsyncKeyLock } from "../helpers/async-lock.js";

const START_READY_TIMEOUT_MS = 5000;

/** Thrown by {@link ChannelManager.addChannel} when a channel with the same
 *  name is already registered. Callers that want hot-swap semantics must call
 *  `removeChannel` first. Re-exported from dispatcher.ts for backward compat. */
export class ChannelAlreadyRegisteredError extends Error {
  readonly channel: string;
  constructor(channel: string) {
    super(`channel ${channel} already registered`);
    this.name = "ChannelAlreadyRegisteredError";
    this.channel = channel;
  }
}

export class ChannelNotFoundError extends Error {
  readonly channelId: string;
  constructor(id: string) {
    super(`no channel registered for id: ${id}`);
    this.name = "ChannelNotFoundError";
    this.channelId = id;
  }
}

export class ChannelStartTimeoutError extends Error {
  readonly channelId: string;
  constructor(id: string) {
    super(`channel ${id} did not become ready within ${START_READY_TIMEOUT_MS}ms`);
    this.name = "ChannelStartTimeoutError";
    this.channelId = id;
  }
}

export interface ChannelManagerDeps {
  logger: Logger;
}

export class ChannelManager {
  private readonly channels = new Map<string, BaseChannel>();
  private readonly lock = new AsyncKeyLock();
  private readonly log: Logger;

  constructor(deps: ChannelManagerDeps) {
    this.log = deps.logger.child({ module: "channel-manager" });
  }

  /**
   * Register an already-constructed channel instance. Throws
   * `ChannelAlreadyRegisteredError` on duplicate — callers that want
   * hot-swap semantics must call `removeChannel` / `removeChannelLocked` first.
   *
   * Must only be called from a code path that already holds the per-id lock
   * (i.e. inside a `withLock(channel.name, ...)` callback). Acquiring the
   * lock here too would deadlock because AsyncKeyLock is not re-entrant.
   */
  addChannel(channel: BaseChannel): void {
    if (this.channels.has(channel.name)) {
      throw new ChannelAlreadyRegisteredError(channel.name);
    }
    this.channels.set(channel.name, channel);
  }

  /** Stop and deregister a channel. Idempotent — no-op if not found. */
  async removeChannel(id: string): Promise<void> {
    return this.lock.acquire(id, async () => {
      await this._stopAndDelete(id);
    });
  }

  /**
   * Stop and delete a channel entry WITHOUT acquiring the lock.
   * Only safe to call while already holding the per-id lock (e.g. inside
   * a `withLock(id, ...)` callback) to avoid deadlocking AsyncKeyLock.
   */
  async removeChannelLocked(id: string): Promise<void> {
    await this._stopAndDelete(id);
  }

  private async _stopAndDelete(id: string): Promise<void> {
    const ch = this.channels.get(id);
    if (!ch) return;
    await ch.stop().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn({ msg, id }, "stop failed during removeChannel");
    });
    this.channels.delete(id);
  }

  private async _startLocked(id: string): Promise<void> {
    const ch = this.channels.get(id);
    if (!ch) throw new ChannelNotFoundError(id);
    await Promise.race([
      ch.start(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ChannelStartTimeoutError(id)), START_READY_TIMEOUT_MS),
      ),
    ]);
  }

  /**
   * One-shot orchestration: plugin.setup → plugin.activate → addChannel → start.
   * All steps run inside the per-id lock so concurrent activate calls serialize.
   * On any failure after plugin.setup succeeds, calls plugin.remove() to roll
   * back credentials, then re-throws the original error.
   *
   * Returns both the channel instance and the setup summary (e.g. bot username)
   * so the RPC caller can surface it to the web UI.
   */
  async activate(
    plugin: ChannelPlugin,
    ctx: ActivateCtx & { token: string },
  ): Promise<{ channel: BaseChannel; summary: string }> {
    return this.lock.acquire(plugin.id, async () => {
      if (this.channels.has(plugin.id)) {
        throw new ChannelSetupError(
          `${plugin.id}_already_registered`,
          `${plugin.label} is already connected — disconnect first.`,
        );
      }

      let setupOk = false;
      try {
        const setupResult = await plugin.setup({ credentials: ctx.credentials, token: ctx.token });
        setupOk = true;

        const channel = await plugin.activate(ctx);
        this.addChannel(channel);

        try {
          await this._startLocked(plugin.id);
        } catch (err) {
          await this._stopAndDelete(plugin.id);
          throw err;
        }

        return { channel, summary: setupResult.summary };
      } catch (err) {
        if (setupOk) {
          await plugin
            .remove({ credentials: ctx.credentials, pairingStore: ctx.pairingStore })
            .catch((rmErr) =>
              this.log.warn({ rmErr, id: plugin.id }, "rollback plugin.remove failed"),
            );
        }
        throw err;
      }
    });
  }

  /**
   * Resume an already-configured channel (daemon boot path): skips plugin.setup
   * since credentials are already persisted. Acquires the per-id lock, calls
   * plugin.activate → addChannel → start with rollback on failure.
   */
  async activateExisting(plugin: ChannelPlugin, ctx: ActivateCtx): Promise<BaseChannel> {
    return this.lock.acquire(plugin.id, async () => {
      if (this.channels.has(plugin.id)) {
        throw new ChannelSetupError(
          `${plugin.id}_already_registered`,
          `${plugin.label} is already connected — disconnect first.`,
        );
      }

      const channel = await plugin.activate(ctx);
      this.addChannel(channel);
      return channel;
    });
  }

  /** Start a registered channel with a timeout race. */
  async startChannel(id: string): Promise<void> {
    return this.lock.acquire(id, async () => {
      try {
        await this._startLocked(id);
      } catch (err) {
        this.log.warn({ channelId: id }, "channel start failed");
        throw err;
      }
    });
  }

  /** Stop a channel without deregistering it. */
  async stopChannel(id: string): Promise<void> {
    return this.lock.acquire(id, async () => {
      const ch = this.channels.get(id);
      if (!ch) return;
      await ch.stop().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn({ msg, id }, "stop failed during stopChannel");
      });
    });
  }

  /** Start all registered channels. Errors per channel are logged and
   *  do not abort the remaining starts. */
  async startAllChannels(): Promise<void> {
    if (this.channels.size === 0) return;
    const tasks = [...this.channels.entries()].map(([id, ch]) =>
      ch.start().catch((err) => this.log.error({ err, channel: id }, "failed to start channel")),
    );
    await Promise.allSettled(tasks);
  }

  /** Stop all registered channels sequentially. Errors per channel are logged
   *  and do not abort remaining stops. */
  async stopAllChannels(): Promise<void> {
    for (const [id, ch] of this.channels) {
      await ch.stop().catch((err) => {
        this.log.warn({ err, channel: id }, "channel stop failed during stopAllChannels");
      });
    }
  }

  /** Aggregate running-state snapshot. Used by the status endpoint. */
  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [id, ch] of this.channels) {
      status[id] = { running: ch.isRunning };
    }
    return status;
  }

  getChannel(id: string): BaseChannel | null {
    return this.channels.get(id) ?? null;
  }

  isActive(id: string): boolean {
    return this.channels.has(id);
  }

  listChannels(): BaseChannel[] {
    return [...this.channels.values()];
  }

  /**
   * Run `fn` while holding the per-channel lock for `id`.
   * Used by RPC handlers that need to serialize against setup/remove.
   */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.acquire(id, fn);
  }
}
