/**
 * MessageDispatcher — bus consumer + outbound routing.
 *
 * Consumes inbound messages from bus, routes through orchestrator.
 * Dispatches outbound messages to channels with retry, coalescing, and filtering.
 *
 * Channel registration/lifecycle is owned by ChannelManager. The dispatcher
 * reads channel instances via manager.getChannel() — no local channels map.
 */

import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { MessageBus } from "../bus/queue.js";
import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import type { Orchestrator } from "../agent/orchestrator.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ChannelManager } from "./manager.js";
import { classifyError } from "../core/errors.js";
import type { Logger } from "pino";

// Re-exported for backward compat — error class lives in manager.ts.
export { ChannelAlreadyRegisteredError } from "./manager.js";

const SEND_RETRY_DELAYS = [1, 2, 4];

export interface DispatcherConfig {
  sendProgress: boolean;
  sendToolHints: boolean;
  sendMaxRetries: number;
  maxConcurrentRequests: number;
}

export class MessageDispatcher {
  private _running = false;
  private semaphoreCount: number;
  private readonly semaphoreQueue: Array<() => void> = [];
  private _stopResolve?: () => void;
  private _stopPromise?: Promise<never>;

  constructor(
    private readonly bus: MessageBus,
    private readonly config: DispatcherConfig,
    private readonly orchestrator: Orchestrator,
    private readonly tools: ToolRegistry,
    private readonly manager: ChannelManager,
    private readonly log: Logger,
  ) {
    this.semaphoreCount = config.maxConcurrentRequests;
  }

  /**
   * Ensure inbound + outbound dispatch loops are running. Idempotent — safe to
   * call from both boot and a runtime register path (gateway live-register,
   * story 17-03). Without this, daemons that boot with zero channels never
   * start the loops, and a later channel add would queue messages that never
   * get drained.
   */
  ensureLoopsRunning(): void {
    if (this._running) return;
    this._running = true;
    void this.dispatchOutbound();
    void this.processInbound();
  }

  stop(): void {
    this._running = false;
    this._stopResolve?.();
    this._stopPromise = undefined;
    this._stopResolve = undefined;
    this.bus.clearWaiters();
  }

  // ---------------------------------------------------------------------------
  // Inbound processing
  // ---------------------------------------------------------------------------

  private async processInbound(): Promise<void> {
    while (this._running) {
      let msg: InboundMessage;
      try {
        msg = await this.consumeOrStop(this.bus.consumeInbound.bind(this.bus));
      } catch { break; }

      // Single-user invariant: all channels share one session keyed "main".
      const sessionKey = "main";

      void this.dispatch(msg, sessionKey).catch(err => {
        const classified = classifyError(err);
        this.log.error({ err, errorType: classified.type }, "processMessage error");
        this.bus.publishOutbound({
          channel: msg.channel, chatId: msg.chatId,
          content: classified.userMessage,
          media: [], metadata: { _errorType: classified.type },
        });
      });
    }
  }

  private async dispatch(msg: InboundMessage, sessionKey: string): Promise<void> {
    await this.acquireSemaphore();
    try {
      const channel = this.manager.getChannel(msg.channel);
      const supportsStreaming = channel?.supportsStreaming === true;
      const streamId = `${sessionKey}:${Date.now()}`;

      // Two-mode state machine driven by orchestrator events.
      //
      // Streaming channel (supportsStreaming === true):
      //   Pre-tool deltas buffer. On tool end, buffer clears and acceptDelta
      //   flips true. First post-tool text_delta flips streaming true; from then
      //   on every delta is published live via publishStreamDelta. On resolve,
      //   a _stream_end marker closes the stream. No-tool prompts bypass the
      //   streaming path and publish the full buffer as a single message.
      //
      // Non-streaming channel (supportsStreaming === false):
      //   Same buffer / acceptDelta lifecycle, but post-tool deltas are pushed
      //   into the buffer instead of published live. On resolve, the buffer is
      //   emitted as one regular outbound message via channel.send(). Pre-tool
      //   narration is dropped on tool end (buffer.length = 0) as in streaming
      //   mode. No per-delta publishes; the channel never sees sendDelta.
      //
      // toolcall_end handles the claude-cli provider: the in-process MCP executor
      // does not emit tool_execution_start/end, so toolcall_end is the synthetic
      // signal that arms acceptDelta.
      const buffer: string[] = [];
      let acceptDelta = false;   // true once a tool has finished — real response incoming
      let streaming = false;     // streaming channel only: true once post-tool delta started
      let runningToolCount = 0;

      const publishStreamDelta = (delta: string): void => {
        this.bus.publishOutbound({
          channel: msg.channel, chatId: msg.chatId, content: delta,
          media: [], metadata: { _stream_delta: true, _stream_id: streamId },
        });
      };

      await this.orchestrator.prompt({
        content: msg.content,
        channel: msg.channel,
        chatId: msg.chatId,
        onEvent: (event: AgentEvent) => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            if (supportsStreaming) {
              if (streaming) {
                publishStreamDelta(delta);
              } else if (acceptDelta) {
                // First post-tool token for streaming channel — go live.
                streaming = true;
                acceptDelta = false;
                publishStreamDelta(delta);
              } else {
                // Pre-tool narration; dropped on tool end.
                buffer.push(delta);
              }
            } else {
              // Non-streaming channel: always buffer. Pre-tool content is
              // dropped on tool end (buffer.length = 0); post-tool deltas
              // accumulate and are emitted as one message on resolve.
              buffer.push(delta);
            }
          } else if (event.type === "tool_execution_start") {
            runningToolCount++;
          } else if (event.type === "tool_execution_end") {
            // Defensive clamp — prevents underflow if a stray end arrives.
            if (runningToolCount > 0) runningToolCount--;
            if (runningToolCount === 0) {
              // Pre-tool narration is confirmed and dropped here.
              buffer.length = 0;
              acceptDelta = true;
            }
          } else if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_end") {
            // Claude CLI provider executes MCP tools inside the CLI process —
            // pi-agent-core never emits tool_execution_start/end. Treat
            // toolcall_end as a synthetic completion so acceptDelta gets armed
            // for the next text_delta.
            buffer.length = 0;
            acceptDelta = true;
          }
        },
      });

      if (supportsStreaming && streaming) {
        // Live streaming already consumed the response — close the stream so
        // the receiving channel finalizes its rendering.
        this.bus.publishOutbound({
          channel: msg.channel, chatId: msg.chatId, content: "",
          media: [], metadata: { _stream_end: true, _stream_id: streamId },
        });
      } else if (buffer.length > 0) {
        // Non-streaming channel (or no-tool prompt on streaming channel):
        // buffer holds the full response. Publish as a single regular message.
        this.bus.publishOutbound({
          channel: msg.channel, chatId: msg.chatId,
          content: buffer.join(""), media: [], metadata: {},
        });
      }

      // Note: startTurn() is called by Orchestrator before each prompt,
      // so no reset needed here.
    } finally {
      this.releaseSemaphore();
    }
  }

  // ---------------------------------------------------------------------------
  // Outbound dispatch
  // ---------------------------------------------------------------------------

  private async dispatchOutbound(): Promise<void> {
    const pending: OutboundMessage[] = [];

    while (this._running) {
      let msg: OutboundMessage;
      try {
        if (pending.length > 0) {
          msg = pending.shift()!;
        } else {
          msg = await this.consumeOrStop(this.bus.consumeOutbound.bind(this.bus));
        }
      } catch { break; }

      // Filter progress/tool hints
      if (msg.metadata._progress) {
        if (msg.metadata._tool_hint && !this.config.sendToolHints) continue;
        if (!msg.metadata._tool_hint && !this.config.sendProgress) continue;
      }

      // Skip already-streamed final messages
      if (msg.metadata._streamed) continue;

      // Coalesce stream deltas
      if (msg.metadata._stream_delta && !msg.metadata._stream_end) {
        const result = this.coalesceStreamDeltas(msg);
        msg = result.merged;
        pending.push(...result.remaining);
      }

      const channel = this.manager.getChannel(msg.channel);
      if (!channel) continue;

      await this.sendWithRetry(channel, msg);
    }
  }

  private coalesceStreamDeltas(first: OutboundMessage): { merged: OutboundMessage; remaining: OutboundMessage[] } {
    const targetKey = `${first.channel}:${first.chatId}`;
    let combined = first.content;
    const finalMeta = { ...first.metadata };
    const remaining: OutboundMessage[] = [];

    while (true) {
      const next = this.bus.tryConsumeOutbound();
      if (!next) break;

      const sameTarget = `${next.channel}:${next.chatId}` === targetKey;
      const isDelta = Boolean(next.metadata._stream_delta);
      const isEnd = Boolean(next.metadata._stream_end);

      if (sameTarget && isDelta && !finalMeta._stream_end) {
        combined += next.content;
        if (isEnd) { finalMeta._stream_end = true; break; }
      } else {
        remaining.push(next);
        break;
      }
    }

    return {
      merged: { channel: first.channel, chatId: first.chatId, content: combined, media: [], metadata: finalMeta },
      remaining,
    };
  }

  private async sendWithRetry(channel: import("./base.js").BaseChannel, msg: OutboundMessage): Promise<void> {
    const maxAttempts = Math.max(this.config.sendMaxRetries, 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (msg.metadata._stream_delta || msg.metadata._stream_end) {
          await channel.sendDelta(msg.chatId, msg.content, msg.metadata);
        } else {
          await channel.send(msg);
        }
        return;
      } catch (err) {
        if (attempt === maxAttempts - 1) {
          this.log.error({ err, channel: msg.channel, attempts: maxAttempts }, "send failed after retries");
          return;
        }
        const delay = SEND_RETRY_DELAYS[Math.min(attempt, SEND_RETRY_DELAYS.length - 1)];
        await Bun.sleep(delay * 1000);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getStopPromise(): Promise<never> {
    if (!this._stopPromise) {
      this._stopPromise = new Promise<never>((_, reject) => {
        this._stopResolve = () => reject(new Error("stopped"));
      });
    }
    return this._stopPromise;
  }

  private async consumeOrStop<T>(consume: () => Promise<T>): Promise<T> {
    return Promise.race([consume(), this.getStopPromise()]);
  }

  private async acquireSemaphore(): Promise<void> {
    if (this.semaphoreCount > 0) { this.semaphoreCount--; return; }
    return new Promise(resolve => this.semaphoreQueue.push(resolve));
  }

  private releaseSemaphore(): void {
    const next = this.semaphoreQueue.shift();
    if (next) next(); else this.semaphoreCount++;
  }
}
