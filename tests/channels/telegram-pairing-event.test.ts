import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore, type PairingStoreEvent } from "../../src/pairing/store.js";
import pino from "pino";

const silent = pino({ level: "silent" });

let db: Database;
let store: PairingStore;

beforeEach(() => {
  db = initDatabase(":memory:");
  store = new PairingStore(db, silent);
});

describe("PairingStore — onEvent emission", () => {
  test("emits 'created' once for a brand-new request", () => {
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    store.upsertRequest({ channel: "telegram", senderId: "111", username: "alice" });

    expect(seen.length).toBe(1);
    const e = seen[0]!;
    expect(e.type).toBe("created");
    if (e.type !== "created") throw new Error("typeguard");
    expect(e.row.channel).toBe("telegram");
    expect(e.row.senderId).toBe("111");
    expect(e.row.username).toBe("alice");
    expect(e.row.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  test("does NOT emit 'created' on repeat upsert (existing row)", () => {
    const seen: PairingStoreEvent[] = [];
    store.upsertRequest({ channel: "telegram", senderId: "222" });
    store.onEvent((e) => seen.push(e));

    store.upsertRequest({ channel: "telegram", senderId: "222" });

    expect(seen.length).toBe(0);
  });

  test("does NOT emit 'created' when limit reached and request silently dropped", () => {
    // H6: global cap is 50. Saturate with distinct senders, then expect the
    // overflow attempt to be dropped silently (no 'created' event).
    for (let i = 0; i < 50; i++) {
      store.upsertRequest({ channel: "telegram", senderId: `sender-${i}` });
    }
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const overflow = store.upsertRequest({ channel: "telegram", senderId: "overflow" });
    expect(overflow.kind).toBe("limit_reached");
    expect(seen.length).toBe(0);
  });

  test("emits 'approved' on approveRequest with full row payload", () => {
    const r333 = store.upsertRequest({ channel: "telegram", senderId: "333", username: "bob" });
    if (r333.kind !== "created") throw new Error("expected created");
    const code = r333.code;
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const approved = store.approveRequest("telegram", code);
    expect(approved).not.toBeNull();
    expect(seen.length).toBe(1);
    const e = seen[0]!;
    expect(e.type).toBe("approved");
    if (e.type !== "approved") throw new Error("typeguard");
    expect(e.row.code).toBe(code);
    expect(e.row.senderId).toBe("333");
    expect(e.row.username).toBe("bob");
  });

  test("does NOT emit 'approved' for unknown code", () => {
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const result = store.approveRequest("telegram", "ZZZZZZZZ");
    expect(result).toBeNull();
    expect(seen.length).toBe(0);
  });

  test("emits 'removed' (reason=rejected) on rejectRequest", () => {
    const r444 = store.upsertRequest({ channel: "telegram", senderId: "444" });
    if (r444.kind !== "created") throw new Error("expected created");
    const code = r444.code;
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const ok = store.rejectRequest("telegram", code);
    expect(ok).toBe(true);
    expect(seen.length).toBe(1);
    const e = seen[0]!;
    expect(e.type).toBe("removed");
    if (e.type !== "removed") throw new Error("typeguard");
    expect(e.code).toBe(code);
    expect(e.reason).toBe("rejected");
  });

  test("does NOT emit 'removed' for unknown code", () => {
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    store.rejectRequest("telegram", "ZZZZZZZZ");
    expect(seen.length).toBe(0);
  });

  test("emits 'allowlist_removed' when removeAllowlist deletes a row", () => {
    store.setAllowlist("telegram", ["alice"]);
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const ok = store.removeAllowlist("telegram", "alice");
    expect(ok).toBe(true);
    expect(seen.length).toBe(1);
    const e = seen[0]!;
    expect(e.type).toBe("allowlist_removed");
    if (e.type !== "allowlist_removed") throw new Error("typeguard");
    expect(e.channel).toBe("telegram");
    expect(e.identity).toBe("alice");
  });

  test("does NOT emit 'allowlist_removed' for unknown identity", () => {
    const seen: PairingStoreEvent[] = [];
    store.onEvent((e) => seen.push(e));

    const ok = store.removeAllowlist("telegram", "ghost");
    expect(ok).toBe(false);
    expect(seen.length).toBe(0);
  });

  test("unsubscribe stops further events", () => {
    const seen: PairingStoreEvent[] = [];
    const unsub = store.onEvent((e) => seen.push(e));
    unsub();

    store.upsertRequest({ channel: "telegram", senderId: "555" });
    expect(seen.length).toBe(0);
  });

  test("listener exception does not break other listeners or caller", () => {
    const seenA: PairingStoreEvent[] = [];
    const seenB: PairingStoreEvent[] = [];
    store.onEvent(() => { throw new Error("listener A boom"); });
    store.onEvent((e) => seenA.push(e));
    store.onEvent((e) => seenB.push(e));

    expect(() => store.upsertRequest({ channel: "telegram", senderId: "666" })).not.toThrow();
    expect(seenA.length).toBe(1);
    expect(seenB.length).toBe(1);
  });
});
