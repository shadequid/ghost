import { describe, test, expect, mock } from "bun:test";
import { MessageBus } from "../../src/bus/queue.js";
import { BaseChannel } from "../../src/channels/base.js";
import { MessageDispatcher } from "../../src/channels/dispatcher.js";
import { ChannelManager, ChannelAlreadyRegisteredError, ChannelNotFoundError, ChannelStartTimeoutError } from "../../src/channels/manager.js";
import { ChannelSetupError } from "../../src/gateway/channel-errors.js";
import type { OutboundMessage } from "../../src/bus/types.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import type { PairingStore } from "../../src/pairing/store.js";
import type { ChannelPlugin, ActivateCtx, SetupCtx, SetupResult, StatusCtx, StatusResult, RemoveCtx, RemoveResult, ApprovalParams } from "../../src/channels/types.js";
import { NOOP_LOGGER } from "../../src/logger.js";

// Stub pairing store — these tests do not exercise allowlist behavior.
const STUB_PAIRING = {
  listAllowlistIdentities: () => ["*"],
} as unknown as PairingStore;

class MockChannel extends BaseChannel {
  readonly name = "mock";
  readonly displayName = "Mock";
  sent: OutboundMessage[] = [];
  deltas: Array<{ chatId: string; delta: string }> = [];

  async start() { this._running = true; }
  async stop() { this._running = false; }
  async send(msg: OutboundMessage) { this.sent.push(msg); }
  async sendDelta(chatId: string, delta: string) { this.deltas.push({ chatId, delta }); }
}

function createTestDispatcher(
  bus: MessageBus,
  manager: ChannelManager,
  config: { sendProgress: boolean; sendToolHints: boolean; sendMaxRetries: number },
): MessageDispatcher {
  const mockOrchestrator = { prompt: async () => "", abort: () => {}, sessionKey: "main" } as unknown as Orchestrator;
  const mockTools = { get: () => undefined, all: () => [] } as unknown as ToolRegistry;
  return new MessageDispatcher(
    bus,
    { ...config, maxConcurrentRequests: 3 },
    mockOrchestrator,
    mockTools,
    manager,
    NOOP_LOGGER,
  );
}

describe("MessageDispatcher — outbound", () => {
  test("routes outbound message to correct channel", async () => {
    const bus = new MessageBus();
    const ch = new MockChannel({ streaming: true }, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    const dispatcher = createTestDispatcher(bus, manager, { sendProgress: true, sendToolHints: false, sendMaxRetries: 1 });

    dispatcher.ensureLoopsRunning();
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "hello", media: [], metadata: {} });
    await Bun.sleep(50);
    dispatcher.stop();

    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0].content).toBe("hello");
  });

  test("filters progress messages when sendProgress=false", async () => {
    const bus = new MessageBus();
    const ch = new MockChannel({}, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    const dispatcher = createTestDispatcher(bus, manager, { sendProgress: false, sendToolHints: false, sendMaxRetries: 1 });

    dispatcher.ensureLoopsRunning();
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "thinking...", media: [], metadata: { _progress: true } });
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "done", media: [], metadata: {} });
    await Bun.sleep(50);
    dispatcher.stop();

    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0].content).toBe("done");
  });

  test("skips _streamed messages", async () => {
    const bus = new MessageBus();
    const ch = new MockChannel({}, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    const dispatcher = createTestDispatcher(bus, manager, { sendProgress: true, sendToolHints: false, sendMaxRetries: 1 });

    dispatcher.ensureLoopsRunning();
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "already sent", media: [], metadata: { _streamed: true } });
    await Bun.sleep(50);
    dispatcher.stop();

    expect(ch.sent).toHaveLength(0);
  });

  test("routes stream deltas to sendDelta", async () => {
    const bus = new MessageBus();
    const ch = new MockChannel({ streaming: true }, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    const dispatcher = createTestDispatcher(bus, manager, { sendProgress: true, sendToolHints: false, sendMaxRetries: 1 });

    dispatcher.ensureLoopsRunning();
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "chunk", media: [], metadata: { _stream_delta: true } });
    await Bun.sleep(50);
    dispatcher.stop();

    expect(ch.deltas).toHaveLength(1);
    expect(ch.deltas[0].delta).toBe("chunk");
  });

  test("getChannel returns channel by name via manager", () => {
    const bus = new MessageBus();
    const ch = new MockChannel({}, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    expect(manager.getChannel("mock")).toBe(ch);
    expect(manager.getChannel("nope")).toBeNull();
  });

  test("listChannels reflects channel names", () => {
    const bus = new MessageBus();
    const ch = new MockChannel({}, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    expect(manager.listChannels().map((c) => c.name)).toEqual(["mock"]);
  });

  test("filters tool hints when sendToolHints=false", async () => {
    const bus = new MessageBus();
    const ch = new MockChannel({}, bus, NOOP_LOGGER, STUB_PAIRING);
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    manager.addChannel(ch);
    const dispatcher = createTestDispatcher(bus, manager, { sendProgress: true, sendToolHints: false, sendMaxRetries: 1 });

    dispatcher.ensureLoopsRunning();
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "using tool...", media: [], metadata: { _progress: true, _tool_hint: true } });
    bus.publishOutbound({ channel: "mock", chatId: "c1", content: "result", media: [], metadata: {} });
    await Bun.sleep(50);
    dispatcher.stop();

    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0].content).toBe("result");
  });
});

// ---------------------------------------------------------------------------
// ChannelManager tests (instance-based API)
// ---------------------------------------------------------------------------

class NamedMockChannel extends BaseChannel {
  constructor(
    public readonly name: string,
    public readonly displayName: string,
    bus: MessageBus,
    public readonly failStart = false,
    public readonly hangStart = false,
  ) {
    super({}, bus, NOOP_LOGGER, STUB_PAIRING);
  }
  async start(): Promise<void> {
    if (this.hangStart) return new Promise(() => {});
    if (this.failStart) throw new Error("start failed");
    this._running = true;
  }
  async stop(): Promise<void> { this._running = false; }
  async send(_msg: OutboundMessage): Promise<void> {}
}

function makeManager(): { bus: MessageBus; manager: ChannelManager } {
  const bus = new MessageBus();
  const manager = new ChannelManager({ logger: NOOP_LOGGER });
  return { bus, manager };
}

describe("ChannelManager", () => {
  test("addChannel + startChannel — channel becomes active", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("alpha", "Alpha", bus);
    manager.addChannel(ch);
    await manager.startChannel("alpha");
    expect(manager.isActive("alpha")).toBe(true);
    expect(ch.isRunning).toBe(true);
  });

  test("addChannel throws ChannelAlreadyRegisteredError on duplicate", () => {
    const { bus, manager } = makeManager();
    const a = new NamedMockChannel("alpha", "Alpha", bus);
    const b = new NamedMockChannel("alpha", "Alpha2", bus);
    manager.addChannel(a);
    expect(() => manager.addChannel(b)).toThrow(ChannelAlreadyRegisteredError);
  });

  test("startChannel throws ChannelNotFoundError for unknown id", async () => {
    const { manager } = makeManager();
    await expect(manager.startChannel("unknown")).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  test("startChannel throws ChannelStartTimeoutError when channel hangs", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("hang", "Hang", bus, false, true);
    manager.addChannel(ch);
    await expect(manager.startChannel("hang")).rejects.toBeInstanceOf(ChannelStartTimeoutError);
  }, 10_000);

  test("startChannel propagates start() error", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("fail", "Fail", bus, true);
    manager.addChannel(ch);
    await expect(manager.startChannel("fail")).rejects.toThrow("start failed");
  });

  test("removeChannel stops the channel and deregisters it", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("omega", "Omega", bus);
    manager.addChannel(ch);
    await manager.startChannel("omega");
    expect(manager.isActive("omega")).toBe(true);

    await manager.removeChannel("omega");
    expect(manager.isActive("omega")).toBe(false);
    expect(ch.isRunning).toBe(false);
  });

  test("removeChannel is idempotent for unknown id", async () => {
    const { manager } = makeManager();
    await expect(manager.removeChannel("nope")).resolves.toBeUndefined();
  });

  test("isActive returns false for unregistered channel", () => {
    const { manager } = makeManager();
    expect(manager.isActive("ghost")).toBe(false);
  });

  test("listChannels reflects added channels", () => {
    const { bus, manager } = makeManager();
    const a = new NamedMockChannel("a", "A", bus);
    const b = new NamedMockChannel("b", "B", bus);
    manager.addChannel(a);
    manager.addChannel(b);
    const names = manager.listChannels().map((c) => c.name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  test("getChannel returns channel by id", () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("test", "Test", bus);
    manager.addChannel(ch);
    expect(manager.getChannel("test")).toBe(ch);
    expect(manager.getChannel("nope")).toBeNull();
  });

  test("getStatus reflects running state", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("sg", "SG", bus);
    manager.addChannel(ch);
    expect(manager.getStatus()).toEqual({ sg: { running: false } });
    await manager.startChannel("sg");
    expect(manager.getStatus()).toEqual({ sg: { running: true } });
  });

  test("startAllChannels starts all registered channels", async () => {
    const { bus, manager } = makeManager();
    const a = new NamedMockChannel("a", "A", bus);
    const b = new NamedMockChannel("b", "B", bus);
    manager.addChannel(a);
    manager.addChannel(b);
    await manager.startAllChannels();
    expect(a.isRunning).toBe(true);
    expect(b.isRunning).toBe(true);
  });

  test("stopAllChannels stops all registered channels", async () => {
    const { bus, manager } = makeManager();
    const a = new NamedMockChannel("a", "A", bus);
    const b = new NamedMockChannel("b", "B", bus);
    manager.addChannel(a);
    manager.addChannel(b);
    await manager.startAllChannels();
    await manager.stopAllChannels();
    expect(a.isRunning).toBe(false);
    expect(b.isRunning).toBe(false);
  });

  test("withLock serializes concurrent calls for same id", async () => {
    const { manager } = makeManager();
    const order: number[] = [];
    let resolveFirst!: () => void;
    const firstStarted = new Promise<void>((res) => { resolveFirst = res; });

    const p1 = manager.withLock("x", async () => {
      resolveFirst();
      await Bun.sleep(30);
      order.push(1);
    });
    await firstStarted;
    const p2 = manager.withLock("x", async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// ChannelManager.activate() tests
// ---------------------------------------------------------------------------

function makeActivatePlugin(opts: {
  id?: string;
  label?: string;
  startFails?: boolean;
  startHangs?: boolean;
  activateFails?: boolean;
} = {}): {
  plugin: ChannelPlugin;
  removeMock: ReturnType<typeof mock>;
  channel: NamedMockChannel;
} {
  const bus = new MessageBus();
  const id = opts.id ?? "test-ch";
  const channel = new NamedMockChannel(id, "Test", bus, opts.startFails, opts.startHangs);
  const removeMock = mock(async () => ({ summary: "removed" }));

  const plugin: ChannelPlugin = {
    id: id as import("../../src/channels/types.js").ChannelId,
    label: opts.label ?? "Test",
    description: "test plugin",
    setup: mock(async (_ctx: SetupCtx): Promise<SetupResult> => ({ summary: "ok" })),
    status: mock(async (_ctx: StatusCtx): Promise<StatusResult> => ({
      enabled: true, healthy: true, summary: "ok", detail: {},
    })),
    remove: removeMock as unknown as (ctx: RemoveCtx) => Promise<RemoveResult>,
    notifyApproval: mock(async (_params: ApprovalParams): Promise<void> => {}),
    activate: mock(async (_ctx: ActivateCtx): Promise<BaseChannel> => {
      if (opts.activateFails) throw new Error("activate failed");
      return channel;
    }),
  };

  return { plugin, removeMock, channel };
}

function makeActivateCtx(): ActivateCtx & { token: string } {
  return {
    config: { telegram: {}, gateway: {}, cron: {} } as unknown as import("../../src/config/schema.js").Config,
    credentials: {
      get: mock(async () => null),
      has: mock(async () => false),
      set: mock(async () => {}),
      delete: mock(async () => {}),
    } as unknown as import("../../src/config/credentials.js").CredentialStore,
    bus: { subscribe: mock(() => () => {}), publish: mock(async () => {}) } as unknown as import("../../src/bus/queue.js").MessageBus,
    eventBus: { subscribe: mock(() => () => {}), publish: mock(() => {}) } as unknown as import("../../src/bus/events.js").EventBus,
    approvalManager: {} as import("../../src/gateway/approval.js").ApprovalManager,
    pairingStore: STUB_PAIRING,
    pairingService: {} as import("../../src/pairing/service.js").PairingService,
    commandServices: {} as import("../../src/channels/telegram/commands/types.js").CommandServices,
    logger: NOOP_LOGGER,
    token: "test-token",
  };
}

describe("ChannelManager.activate()", () => {
  test("happy path: setup → activate → addChannel → start, returns running channel + summary", async () => {
    const { bus, manager } = makeManager();
    void bus;
    const { plugin, channel } = makeActivatePlugin();
    const ctx = makeActivateCtx();

    const result = await manager.activate(plugin, ctx);

    expect(result.channel).toBe(channel);
    expect(result.summary).toBe("ok");
    expect(channel.isRunning).toBe(true);
    expect(manager.isActive("test-ch")).toBe(true);
  });

  test("rejects with ChannelSetupError when channel already running", async () => {
    const { bus, manager } = makeManager();
    const ch = new NamedMockChannel("test-ch", "Test", bus);
    manager.addChannel(ch);
    await manager.startChannel("test-ch");

    const { plugin } = makeActivatePlugin();
    const ctx = makeActivateCtx();

    await expect(manager.activate(plugin, ctx)).rejects.toBeInstanceOf(ChannelSetupError);
  });

  test("rollback: plugin.activate throws → plugin.remove called, channel not registered", async () => {
    const { manager } = makeManager();
    const { plugin, removeMock } = makeActivatePlugin({ activateFails: true });
    const ctx = makeActivateCtx();

    await expect(manager.activate(plugin, ctx)).rejects.toThrow("activate failed");
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(manager.isActive("test-ch")).toBe(false);
  });

  test("rollback: channel.start throws → plugin.remove called, channel not registered", async () => {
    const { manager } = makeManager();
    const { plugin, removeMock } = makeActivatePlugin({ startFails: true });
    const ctx = makeActivateCtx();

    await expect(manager.activate(plugin, ctx)).rejects.toThrow("start failed");
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(manager.isActive("test-ch")).toBe(false);
  });

  test("setup failure → plugin.remove NOT called (nothing was written)", async () => {
    const { manager } = makeManager();
    const { plugin, removeMock } = makeActivatePlugin();
    const ctx = makeActivateCtx();
    // Override setup to fail
    (plugin as unknown as { setup: () => Promise<SetupResult> }).setup = async () => {
      throw new Error("setup failed");
    };

    await expect(manager.activate(plugin, ctx)).rejects.toThrow("setup failed");
    expect(removeMock).not.toHaveBeenCalled();
    expect(manager.isActive("test-ch")).toBe(false);
  });

  test("rejects stale non-running entry (zombie) on activate", async () => {
    const { manager } = makeManager();
    const bus = new MessageBus();

    // Seed a non-running entry — simulates a half-failed previous attempt that
    // left _running=false but never deleted the map entry.
    const zombie = new NamedMockChannel("test-ch", "Test", bus);
    manager.addChannel(zombie);
    // Verify it is registered but not running.
    expect(manager.isActive("test-ch")).toBe(true);
    expect(zombie.isRunning).toBe(false);

    const { plugin } = makeActivatePlugin();
    const ctx = makeActivateCtx();

    // activate() must reject even though isRunning is false.
    await expect(manager.activate(plugin, ctx)).rejects.toBeInstanceOf(ChannelSetupError);
    // Zombie entry must still be there — caller must call remove() explicitly.
    expect(manager.isActive("test-ch")).toBe(true);
  });

  test("concurrency: two parallel activate calls serialize — second sees already-registered", async () => {
    const { manager } = makeManager();
    const bus = new MessageBus();

    let resolveFirst!: () => void;
    const firstStarted = new Promise<void>((res) => { resolveFirst = res; });

    // First plugin holds the lock briefly
    const slowChannel = new NamedMockChannel("slow-ch", "Slow", bus);
    const plugin1: ChannelPlugin = {
      id: "slow-ch" as import("../../src/channels/types.js").ChannelId,
      label: "Slow",
      description: "",
      setup: mock(async () => {
        resolveFirst();
        await Bun.sleep(30);
        return { summary: "ok" };
      }),
      status: mock(async () => ({ enabled: true, healthy: true, summary: "ok", detail: {} })),
      remove: mock(async () => ({ summary: "removed" })),
      notifyApproval: mock(async () => {}),
      activate: mock(async () => slowChannel),
    };

    const plugin2: ChannelPlugin = { ...plugin1 };

    const ctx = makeActivateCtx();
    const ctx2: ActivateCtx & { token: string } = { ...ctx };

    const p1 = manager.activate(plugin1, ctx);
    await firstStarted;
    const p2 = manager.activate(plugin2, ctx2);

    await p1;
    await expect(p2).rejects.toBeInstanceOf(ChannelSetupError);
  });
});
