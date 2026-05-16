import { describe, test, expect, mock } from "bun:test";
import { getOutboundChannels, dispatchOutbound } from "../../src/channels/index.js";

const noopLogger = { warn: mock(), info: mock(), error: mock() } as any;

function makeManager(telegramActive: boolean) {
  return { isActive: (id: string) => id === "telegram" && telegramActive } as any;
}

describe("getOutboundChannels", () => {
  test("web only when telegram inactive", () => {
    const channels = getOutboundChannels({
      channelManager: makeManager(false),
      pairingStore: { getPrimaryChatId: () => null } as any,
      logger: noopLogger,
    });
    expect(channels).toEqual([{ kind: "web" }]);
  });

  test("web only when telegram active but no chat id", () => {
    const channels = getOutboundChannels({
      channelManager: makeManager(true),
      pairingStore: { getPrimaryChatId: () => null } as any,
      logger: noopLogger,
    });
    expect(channels.map((c) => c.kind)).toEqual(["web"]);
  });

  test("web + telegram when paired", () => {
    const channels = getOutboundChannels({
      channelManager: makeManager(true),
      pairingStore: { getPrimaryChatId: () => "12345" } as any,
      logger: noopLogger,
    });
    expect(channels).toEqual([
      { kind: "web" },
      { kind: "telegram", chatId: "12345" },
    ]);
  });

  test("web is always first", () => {
    const channels = getOutboundChannels({
      channelManager: makeManager(true),
      pairingStore: { getPrimaryChatId: () => "12345" } as any,
      logger: noopLogger,
    });
    expect(channels[0]?.kind).toBe("web");
  });
});

describe("dispatchOutbound", () => {
  function makeBuses() {
    const published: Array<{ type: string; payload: unknown }> = [];
    const outbound: Array<{ channel: string; chatId: string; content: string }> = [];
    const eventBus = { publish: (e: any) => { published.push(e); }, subscribe: () => () => {} } as any;
    const bus = {
      publishOutbound: (m: any) => { outbound.push({ channel: m.channel, chatId: m.chatId, content: m.content }); },
    } as any;
    return { eventBus, bus, published, outbound };
  }

  test("web path publishes chat.proactive event", async () => {
    const { eventBus, bus, published, outbound } = makeBuses();
    const result = await dispatchOutbound(
      [{ kind: "web" }],
      "hello",
      { eventBus, bus, source: "test", logger: noopLogger },
    );
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe("chat.proactive");
    expect((published[0].payload as any).source).toBe("test");
    expect((published[0].payload as any).content).toBe("hello");
    expect(outbound).toHaveLength(0);
    expect(result.delivered).toEqual(["web"]);
  });

  test("fanout publishes web event AND telegram outbound message", async () => {
    const { eventBus, bus, published, outbound } = makeBuses();
    const result = await dispatchOutbound(
      [{ kind: "web" }, { kind: "telegram", chatId: "777" }],
      "hi",
      { eventBus, bus, source: "test", logger: noopLogger },
    );
    expect(published).toHaveLength(1);
    expect(outbound).toEqual([{ channel: "telegram", chatId: "777", content: "hi" }]);
    expect(result.delivered).toEqual(["web", "telegram"]);
  });

  test("web publish failure does not block telegram delivery", async () => {
    const { bus, outbound } = makeBuses();
    const eventBus = {
      publish: () => { throw new Error("eventBus down"); },
      subscribe: () => () => {},
    } as any;
    const result = await dispatchOutbound(
      [{ kind: "web" }, { kind: "telegram", chatId: "777" }],
      "hi",
      { eventBus, bus, source: "test", logger: noopLogger },
    );
    expect(outbound).toHaveLength(1);
    expect(result.delivered).toEqual(["telegram"]);
  });
});
