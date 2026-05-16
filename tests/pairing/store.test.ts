import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore } from "../../src/pairing/store.js";
import pino from "pino";

const silent = pino({ level: "silent" });

let db: Database;
let store: PairingStore;

beforeEach(() => {
  db = initDatabase(":memory:");
  store = new PairingStore(db, silent);
});

/** Convenience: assert the result is "created" and return the code. */
function assertCreated(result: ReturnType<PairingStore["upsertRequest"]>): string {
  expect(result.kind).toBe("created");
  if (result.kind !== "created") throw new Error("unreachable");
  return result.code;
}

describe("PairingStore.upsertRequest", () => {
  test("creates new request with unique 8-char code", () => {
    const result = store.upsertRequest({
      channel: "telegram",
      senderId: "12345",
    });
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  test("returns existing code + updates last_seen_at on repeat", () => {
    const first = store.upsertRequest({ channel: "telegram", senderId: "abc" });
    const before = Date.now();
    while (Date.now() - before < 5) { /* spin */ }
    const second = store.upsertRequest({ channel: "telegram", senderId: "abc" });
    expect(second.kind).toBe("existing");
    expect(first.kind).toBe("created");
    if (second.kind === "existing" && first.kind === "created") {
      expect(second.code).toBe(first.code);
    }
  });

  test("preserves username on upsert", () => {
    store.upsertRequest({ channel: "telegram", senderId: "1", username: "alice" });
    const list = store.listRequests("telegram");
    expect(list[0]!.username).toBe("alice");
  });

  test("returns limit_reached when global per-channel cap is hit", () => {
    for (let i = 0; i < 50; i++) {
      store.upsertRequest({ channel: "telegram", senderId: `sender-${i}` });
    }
    const overflow = store.upsertRequest({ channel: "telegram", senderId: "sender-50" });
    expect(overflow.kind).toBe("limit_reached");
  });

  test("repeat /pair from same sender always returns existing (per-sender cap = 1, H6)", () => {
    const first = store.upsertRequest({ channel: "telegram", senderId: "spammer" });
    expect(first.kind).toBe("created");
    for (let i = 0; i < 10; i++) {
      const repeat = store.upsertRequest({ channel: "telegram", senderId: "spammer" });
      expect(repeat.kind).toBe("existing");
      if (repeat.kind === "existing" && first.kind === "created") {
        expect(repeat.code).toBe(first.code);
      }
    }
    expect(store.listRequests("telegram")).toHaveLength(1);
  });

  test("one fake sender does not block other senders from pairing (H6)", () => {
    store.upsertRequest({ channel: "telegram", senderId: "fake" });
    for (let i = 0; i < 5; i++) {
      const r = store.upsertRequest({ channel: "telegram", senderId: `legit-${i}` });
      expect(r.kind).toBe("created");
    }
  });

  test("limit_reached: allowlist entries and existing requests are unaffected", () => {
    // Fill to cap with distinct senders.
    for (let i = 0; i < 50; i++) {
      const r = store.upsertRequest({ channel: "telegram", senderId: `s-${i}` });
      expect(r.kind).toBe("created");
    }
    // Allowlist entry must not be counted toward the pending cap.
    store.setAllowlist("telegram", ["999"]);
    expect(store.listAllowlist("telegram")).toHaveLength(1);
    // Overflow attempt returns limit_reached, not limit_reached for allowlisted.
    const overflow = store.upsertRequest({ channel: "telegram", senderId: "new-sender" });
    expect(overflow.kind).toBe("limit_reached");
    // Existing senders still get their existing code.
    const existing = store.upsertRequest({ channel: "telegram", senderId: "s-0" });
    expect(existing.kind).toBe("existing");
  });
});

describe("PairingStore.approveRequest", () => {
  test("removes pending and inserts allowlist atomically", () => {
    const code = assertCreated(store.upsertRequest({ channel: "telegram", senderId: "111" }));
    const result = store.approveRequest("telegram", code);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("111");
    expect(store.listRequests("telegram")).toHaveLength(0);
    const allow = store.listAllowlist("telegram");
    expect(allow).toHaveLength(1);
    expect(allow[0]!.identity).toBe("111");
    expect(allow[0]!.identityKind).toBe("id");
  });

  test("uses 'username' identity_kind when sender_id is non-numeric", () => {
    store.upsertRequest({ channel: "telegram", senderId: "alice", username: "alice" });
    const list = store.listRequests("telegram");
    const result = store.approveRequest("telegram", list[0]!.code);
    expect(result!.id).toBe("alice");
    const allow = store.listAllowlist("telegram");
    expect(allow[0]!.identityKind).toBe("username");
  });

  test("returns null for unknown code", () => {
    expect(store.approveRequest("telegram", "ZZZZZZZZ")).toBeNull();
  });

  test("returns null for expired code (purged on access)", () => {
    const code = assertCreated(store.upsertRequest({ channel: "telegram", senderId: "exp" }));
    db.run("UPDATE pairing_requests SET expires_at = 0 WHERE code = ?", [code]);
    expect(store.approveRequest("telegram", code)).toBeNull();
  });
});

describe("PairingStore listener exceptions", () => {
  test("throwing listener is logged at warn and does not break other listeners", () => {
    const warnMessages: unknown[] = [];
    const warnLogger = {
      ...silent,
      warn: (...args: unknown[]) => { warnMessages.push(args); },
    } as unknown as ConstructorParameters<typeof PairingStore>[1];

    const localStore = new PairingStore(initDatabase(":memory:"), warnLogger);

    const good: string[] = [];
    localStore.onEvent((e) => { throw new Error("listener blow-up"); });
    localStore.onEvent((e) => { good.push(e.type); });

    localStore.upsertRequest({ channel: "telegram", senderId: "777" });

    expect(good).toEqual(["created"]);
    expect(warnMessages.length).toBe(1);
    const [obj, msg] = warnMessages[0] as [Record<string, unknown>, string];
    expect(msg).toBe("PairingStore listener threw");
    expect(obj["eventType"]).toBe("created");
    expect(obj["err"]).toBeInstanceOf(Error);
  });
});

describe("PairingStore.setAllowlist", () => {
  test("populates display_name for username-kind and null for id-kind", () => {
    store.setAllowlist("telegram", ["alice", "@bob", "123456", "789"]);
    const entries = store.listAllowlist("telegram");

    const alice = entries.find((e) => e.identity === "alice");
    const bob = entries.find((e) => e.identity === "bob");
    const id1 = entries.find((e) => e.identity === "123456");
    const id2 = entries.find((e) => e.identity === "789");

    expect(alice?.identityKind).toBe("username");
    expect(alice?.displayName).toBe("alice");

    expect(bob?.identityKind).toBe("username");
    expect(bob?.displayName).toBe("bob");

    expect(id1?.identityKind).toBe("id");
    expect(id1?.displayName).toBeNull();

    expect(id2?.identityKind).toBe("id");
    expect(id2?.displayName).toBeNull();
  });

  test("strips leading @ before normalizing username-kind display_name", () => {
    store.setAllowlist("telegram", ["@charlie"]);
    const entries = store.listAllowlist("telegram");
    const charlie = entries.find((e) => e.identity === "charlie");
    expect(charlie?.displayName).toBe("charlie");
  });
});

describe("PairingStore.rejectRequest", () => {
  test("deletes pending and returns true", () => {
    const code = assertCreated(store.upsertRequest({ channel: "telegram", senderId: "222" }));
    expect(store.rejectRequest("telegram", code)).toBe(true);
    expect(store.listRequests("telegram")).toHaveLength(0);
    expect(store.listAllowlist("telegram")).toHaveLength(0);
  });

  test("returns false for unknown code", () => {
    expect(store.rejectRequest("telegram", "ZZZZZZZZ")).toBe(false);
  });
});
