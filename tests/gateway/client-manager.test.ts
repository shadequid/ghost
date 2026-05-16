import { describe, test, expect } from "bun:test";
import pino from "pino";
import { ClientManager, type ConnectedClient } from "../../src/gateway/client-manager.js";

const silent = pino({ level: "silent" });

function mockClient(id: string): ConnectedClient & { sent: string[] } {
  const sent: string[] = [];
  return {
    id,
    sessionId: `s_${id}`,
    ws: { send: (data: string) => sent.push(data) },
    connectedAt: Date.now(),
    seq: 0,
    sent,
  };
}

describe("ClientManager", () => {
  test("add and get client", () => {
    const mgr = new ClientManager(silent);
    const c = mockClient("c1");
    mgr.add(c);
    expect(mgr.get("c1")).toBe(c);
    expect(mgr.count).toBe(1);
  });

  test("remove client", () => {
    const mgr = new ClientManager(silent);
    mgr.add(mockClient("c1"));
    mgr.remove("c1");
    expect(mgr.get("c1")).toBeUndefined();
    expect(mgr.count).toBe(0);
  });

  test("emit sends event to specific client", () => {
    const mgr = new ClientManager(silent);
    const c1 = mockClient("c1");
    const c2 = mockClient("c2");
    mgr.add(c1);
    mgr.add(c2);

    mgr.emit("c1", "test.event", { data: 1 });

    expect(c1.sent).toHaveLength(1);
    const frame = JSON.parse(c1.sent[0]);
    expect(frame.type).toBe("event");
    expect(frame.event).toBe("test.event");
    expect(frame.payload).toEqual({ data: 1 });
    expect(frame.seq).toBe(1);
    expect(c2.sent).toHaveLength(0);
  });

  test("broadcast sends event to all clients", () => {
    const mgr = new ClientManager(silent);
    const c1 = mockClient("c1");
    const c2 = mockClient("c2");
    mgr.add(c1);
    mgr.add(c2);

    mgr.broadcast("health.changed", { status: "ok" });

    expect(c1.sent).toHaveLength(1);
    expect(c2.sent).toHaveLength(1);
    expect(JSON.parse(c1.sent[0]).seq).toBe(1);
    expect(JSON.parse(c2.sent[0]).seq).toBe(1);
  });

  test("seq increments per client", () => {
    const mgr = new ClientManager(silent);
    const c = mockClient("c1");
    mgr.add(c);

    mgr.emit("c1", "a", {});
    mgr.emit("c1", "b", {});

    expect(JSON.parse(c.sent[0]).seq).toBe(1);
    expect(JSON.parse(c.sent[1]).seq).toBe(2);
  });

  test("emit to nonexistent client is no-op", () => {
    const mgr = new ClientManager(silent);
    mgr.emit("nope", "test", {});
    // No error thrown
  });
});

describe("ClientManager.broadcast fan-out resilience", () => {
  function makeClient(id: string, send: (data: string) => void) {
    return {
      id, sessionId: "s-" + id, ws: { send },
      connectedAt: 0, seq: 0,
    };
  }

  test("throwing ws.send evicts that client but siblings still receive", () => {
    const cm = new ClientManager(silent);
    const received: string[] = [];
    cm.add(makeClient("a", (d) => received.push("a:" + d)));
    cm.add(makeClient("b", () => { throw new Error("socket dead"); }));
    cm.add(makeClient("c", (d) => received.push("c:" + d)));

    cm.broadcast("test.event", { n: 1 });

    expect(received.length).toBe(2);
    expect(received[0].startsWith("a:")).toBe(true);
    expect(received[1].startsWith("c:")).toBe(true);
    expect(cm.count).toBe(2);
    expect(cm.get("b")).toBeUndefined();
  });

  test("all-throw evicts everyone and fires countChange listener", () => {
    const cm = new ClientManager(silent);
    let observedCount = -1;
    cm.onCountChange((n) => { observedCount = n; });
    cm.add(makeClient("a", () => { throw new Error("x"); }));
    cm.add(makeClient("b", () => { throw new Error("y"); }));

    cm.broadcast("test.event", {});

    expect(cm.count).toBe(0);
    expect(observedCount).toBe(0);
  });
});
