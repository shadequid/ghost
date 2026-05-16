import { describe, test, expect, mock } from "bun:test";
import pino from "pino";
import { EventBus } from "../../src/bus/events.js";

const silentLogger = pino({ level: "silent" });

interface TestEvent { type: "test.event"; payload: { value: number } }

function testEvent(n: number): TestEvent { return { type: "test.event", payload: { value: n } }; }

describe("EventBus", () => {
  test("publish with no subscribers is a no-op", () => {
    const bus = new EventBus(silentLogger);
    expect(() => bus.publish(testEvent(1) as never)).not.toThrow();
  });

  test("publish delivers to all subscribers in registration order", () => {
    const bus = new EventBus(silentLogger);
    const received: number[] = [];
    bus.subscribe((e) => received.push(1 + (e.payload as unknown as { value: number }).value));
    bus.subscribe((e) => received.push(10 + (e.payload as unknown as { value: number }).value));
    bus.subscribe((e) => received.push(100 + (e.payload as unknown as { value: number }).value));
    bus.publish(testEvent(1) as never);
    expect(received).toEqual([2, 11, 101]);
  });

  test("throwing subscriber does not break siblings", () => {
    const bus = new EventBus(silentLogger);
    const calls: string[] = [];
    bus.subscribe(() => calls.push("first"));
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe(() => calls.push("third"));
    bus.publish(testEvent(0) as never);
    expect(calls).toEqual(["first", "third"]);
  });

  test("unsubscribe stops delivery", () => {
    const bus = new EventBus(silentLogger);
    const calls: number[] = [];
    const off = bus.subscribe(() => calls.push(1));
    bus.publish(testEvent(0) as never);
    off();
    bus.publish(testEvent(0) as never);
    expect(calls).toEqual([1]);
  });

  test("logger.warn is called when a subscriber throws", () => {
    const warn = mock(() => {});
    const logger = { warn, error: () => {}, info: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => logger } as unknown as pino.Logger;
    const bus = new EventBus(logger);
    bus.subscribe(() => { throw new Error("boom"); });
    bus.publish(testEvent(0) as never);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
