import { describe, test, expect } from "bun:test";
import { MessageBus } from "../../src/bus/queue.js";
import type { InboundMessage, OutboundMessage } from "../../src/bus/types.js";

function makeInbound(content: string): InboundMessage {
  return {
    channel: "test", senderId: "user1", chatId: "chat1",
    content, timestamp: Date.now(), media: [], metadata: {},
  };
}

function makeOutbound(content: string): OutboundMessage {
  return { channel: "test", chatId: "chat1", content, media: [], metadata: {} };
}

describe("MessageBus", () => {
  test("publishInbound + consumeInbound round-trip", async () => {
    const bus = new MessageBus();
    bus.publishInbound(makeInbound("hello"));
    const received = await bus.consumeInbound();
    expect(received.content).toBe("hello");
  });

  test("publishOutbound + consumeOutbound round-trip", async () => {
    const bus = new MessageBus();
    bus.publishOutbound(makeOutbound("response"));
    const received = await bus.consumeOutbound();
    expect(received.content).toBe("response");
  });

  test("consumeInbound blocks until message available", async () => {
    const bus = new MessageBus();
    let received: InboundMessage | null = null;
    const consumer = bus.consumeInbound().then(m => { received = m; });
    expect(received).toBeNull();
    bus.publishInbound(makeInbound("delayed"));
    await consumer;
    expect(received!.content).toBe("delayed");
  });

  test("inboundSize and outboundSize track queue depth", () => {
    const bus = new MessageBus();
    expect(bus.inboundSize).toBe(0);
    bus.publishInbound(makeInbound("a"));
    bus.publishInbound(makeInbound("b"));
    expect(bus.inboundSize).toBe(2);
    expect(bus.outboundSize).toBe(0);
  });

  test("FIFO ordering preserved", async () => {
    const bus = new MessageBus();
    bus.publishInbound(makeInbound("first"));
    bus.publishInbound(makeInbound("second"));
    const a = await bus.consumeInbound();
    const b = await bus.consumeInbound();
    expect(a.content).toBe("first");
    expect(b.content).toBe("second");
  });

  test("tryConsumeOutbound returns null when empty", () => {
    const bus = new MessageBus();
    expect(bus.tryConsumeOutbound()).toBeNull();
  });

  test("tryConsumeOutbound returns message when available", () => {
    const bus = new MessageBus();
    bus.publishOutbound(makeOutbound("ready"));
    const msg = bus.tryConsumeOutbound();
    expect(msg!.content).toBe("ready");
    expect(bus.outboundSize).toBe(0);
  });
});
