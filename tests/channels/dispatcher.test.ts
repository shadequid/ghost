import { describe, test, expect, spyOn } from "bun:test";
import { MessageBus } from "../../src/bus/queue.js";
import { BaseChannel } from "../../src/channels/base.js";
import { MessageDispatcher } from "../../src/channels/dispatcher.js";
import { ChannelManager, ChannelAlreadyRegisteredError } from "../../src/channels/manager.js";
import type { OutboundMessage } from "../../src/bus/types.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import type { PairingStore } from "../../src/pairing/store.js";
import { NOOP_LOGGER } from "../../src/logger.js";

// Tests in this file exercise dispatcher/manager lifecycle, not allowlist
// behavior — so a stub PairingStore is sufficient.
const STUB_PAIRING = {
  listAllowlistIdentities: () => ["*"],
} as unknown as PairingStore;

class TrackingChannel extends BaseChannel {
  readonly name: string;
  readonly displayName = "Tracking";
  stopCalls = 0;
  stopShouldThrow = false;

  constructor(name: string, bus: MessageBus) {
    super({}, bus, NOOP_LOGGER, STUB_PAIRING);
    this.name = name;
  }

  async start() { this._running = true; }
  async stop() {
    this.stopCalls++;
    this._running = false;
    if (this.stopShouldThrow) throw new Error("boom");
  }
  async send(_msg: OutboundMessage) {}
}

function makeManager(bus: MessageBus): ChannelManager {
  return new ChannelManager({ logger: NOOP_LOGGER });
}

function makeDispatcher(bus: MessageBus, manager: ChannelManager): MessageDispatcher {
  const orch = { prompt: async () => "", abort: () => {}, sessionKey: "main" } as unknown as Orchestrator;
  const tools = { get: () => undefined, all: () => [] } as unknown as ToolRegistry;
  return new MessageDispatcher(
    bus,
    { sendProgress: false, sendToolHints: false, sendMaxRetries: 1, maxConcurrentRequests: 3 },
    orch,
    tools,
    manager,
    NOOP_LOGGER,
  );
}

class DeltaTrackingChannel extends BaseChannel {
  readonly name: string;
  readonly displayName = "DeltaTracking";
  readonly deltaCalls: Array<{ chatId: string; content: string; isEnd: boolean }> = [];

  constructor(name: string, bus: MessageBus) {
    super({}, bus, NOOP_LOGGER, STUB_PAIRING);
    this.name = name;
  }

  async start() { this._running = true; }
  async stop() { this._running = false; }
  async send(_msg: OutboundMessage) {}
  async sendDelta(chatId: string, content: string, meta: Record<string, unknown>) {
    this.deltaCalls.push({ chatId, content, isEnd: Boolean(meta._stream_end) });
  }
}

describe("ChannelManager.stopAllChannels", () => {
  test("logs warn for channel whose stop() throws but still stops sibling", async () => {
    const bus = new MessageBus();
    const good = new TrackingChannel("good", bus);
    const bad = new TrackingChannel("bad", bus);
    bad.stopShouldThrow = true;

    const warnSpy = spyOn(NOOP_LOGGER, "warn");
    const manager = makeManager(bus);
    manager.addChannel(good);
    manager.addChannel(bad);

    await manager.stopAllChannels();

    expect(good.stopCalls).toBe(1);
    expect(bad.stopCalls).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "bad" }),
      "channel stop failed during stopAllChannels",
    );
    warnSpy.mockRestore();
  });
});

describe("MessageDispatcher restart", () => {
  test("inbound is consumed after stopAllChannels + startAllChannels", async () => {
    const bus = new MessageBus();
    // Orchestrator echoes content so we can confirm inbound was processed.
    const echoed: string[] = [];
    const orch = {
      prompt: async ({ content, channel, chatId }: { content: string; channel: string; chatId: string }) => {
        echoed.push(content);
        // Publish outbound to drain the outbound loop too.
        bus.publishOutbound({ channel, chatId, content, media: [], metadata: {} });
      },
      abort: () => {},
      sessionKey: "main",
    } as unknown as Orchestrator;
    const tools = { get: () => undefined, all: () => [] } as unknown as ToolRegistry;
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    const dispatcher = new MessageDispatcher(
      bus,
      { sendProgress: false, sendToolHints: false, sendMaxRetries: 1, maxConcurrentRequests: 3 },
      orch,
      tools,
      manager,
      NOOP_LOGGER,
    );
    const ch = new TrackingChannel("restart-ch", bus);
    manager.addChannel(ch);

    dispatcher.ensureLoopsRunning();
    await manager.startAllChannels();
    await manager.stopAllChannels();
    dispatcher.stop();

    // Restart: loops run again after re-ensureLoopsRunning.
    dispatcher.ensureLoopsRunning();
    bus.publishInbound({ channel: "restart-ch", senderId: "u1", chatId: "42", content: "hello", timestamp: Date.now(), media: [], metadata: {} });

    const deadline = Date.now() + 1000;
    while (echoed.length === 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }

    expect(echoed).toEqual(["hello"]);
    dispatcher.stop();
  });
});

describe("ChannelManager.removeChannel", () => {
  test("removes channel and calls stop()", async () => {
    const bus = new MessageBus();
    const ch = new TrackingChannel("alpha", bus);
    const manager = makeManager(bus);
    manager.addChannel(ch);
    expect(manager.getChannel("alpha")).toBe(ch);

    await manager.removeChannel("alpha");

    expect(manager.getChannel("alpha")).toBeNull();
    expect(ch.stopCalls).toBe(1);
    expect(manager.listChannels()).toEqual([]);
  });

  test("is idempotent for unknown name", async () => {
    const bus = new MessageBus();
    const manager = makeManager(bus);
    await manager.removeChannel("does-not-exist");
    expect(manager.listChannels()).toEqual([]);
  });

  test("swallows stop() errors but still removes channel", async () => {
    const bus = new MessageBus();
    const ch = new TrackingChannel("beta", bus);
    ch.stopShouldThrow = true;
    const manager = makeManager(bus);
    manager.addChannel(ch);

    await manager.removeChannel("beta");

    expect(manager.getChannel("beta")).toBeNull();
    expect(ch.stopCalls).toBe(1);
  });

  test("does not affect sibling channels", async () => {
    const bus = new MessageBus();
    const a = new TrackingChannel("a", bus);
    const b = new TrackingChannel("b", bus);
    const manager = makeManager(bus);
    manager.addChannel(a);
    manager.addChannel(b);

    await manager.removeChannel("a");

    expect(manager.getChannel("a")).toBeNull();
    expect(manager.getChannel("b")).toBe(b);
    expect(b.stopCalls).toBe(0);
  });
});

describe("ChannelAlreadyRegisteredError (re-exported from dispatcher)", () => {
  test("re-export from dispatcher.ts matches manager.ts class", async () => {
    const { ChannelAlreadyRegisteredError: FromDispatcher } = await import("../../src/channels/dispatcher.js");
    expect(FromDispatcher).toBe(ChannelAlreadyRegisteredError);
  });
});

describe("MessageDispatcher outbound coalesce — standalone _stream_end", () => {
  test("routes standalone _stream_end (no _stream_delta) to sendDelta with empty content + isEnd=true", async () => {
    const bus = new MessageBus();
    const ch = new DeltaTrackingChannel("delta-ch", bus);
    const manager = makeManager(bus);
    manager.addChannel(ch);
    const dispatcher = makeDispatcher(bus, manager);
    dispatcher.ensureLoopsRunning();

    // Publish a standalone _stream_end with no preceding _stream_delta.
    bus.publishOutbound({
      channel: "delta-ch", chatId: "99", content: "",
      media: [], metadata: { _stream_end: true, _stream_id: "s1" },
    });

    const deadline = Date.now() + 1000;
    while (ch.deltaCalls.length === 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }

    expect(ch.deltaCalls).toHaveLength(1);
    expect(ch.deltaCalls[0]).toEqual({ chatId: "99", content: "", isEnd: true });

    dispatcher.stop();
  });
});
