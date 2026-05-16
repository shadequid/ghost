import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import pino from "pino";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore } from "../../src/pairing/store.js";
import { EventBus } from "../../src/bus/events.js";
import { PairingService } from "../../src/pairing/service.js";

const silent = pino({ level: "silent" });

let db: Database;
let store: PairingStore;
let eventBus: EventBus;
let service: PairingService;

beforeEach(() => {
  db = initDatabase(":memory:");
  store = new PairingStore(db, silent);
  eventBus = new EventBus(silent);
  service = new PairingService(store, eventBus, silent);
});

describe("PairingService.issueChallenge", () => {
  test("creates request, returns code, and invokes sendReply once for new sender", async () => {
    const replies: string[] = [];
    const result = await service.issueChallenge({
      channelId: "telegram",
      identity: "123456",
      sendReply: async (text) => { replies.push(text); },
    });

    expect(result.created).toBe(true);
    expect(typeof result.code).toBe("string");
    expect(result.code!.length).toBeGreaterThan(0);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain(result.code!);

    const requests = store.listRequests("telegram");
    expect(requests.length).toBe(1);
    expect(requests[0]!.senderId).toBe("123456");
  });

  test("repeat sender within TTL returns existing — sendReply NOT invoked", async () => {
    await service.issueChallenge({
      channelId: "telegram",
      identity: "789",
      sendReply: async () => {},
    });

    const replies: string[] = [];
    const second = await service.issueChallenge({
      channelId: "telegram",
      identity: "789",
      sendReply: async (text) => { replies.push(text); },
    });

    expect(second.created).toBe(false);
    expect(second.code).toBeUndefined();
    expect(replies.length).toBe(0);
    expect(store.listRequests("telegram").length).toBe(1);
  });

  test("uses identityLabel in reply when provided", async () => {
    const replies: string[] = [];
    await service.issueChallenge({
      channelId: "telegram",
      identity: "111",
      identityLabel: "Your Telegram user id: 111 (@alice)",
      sendReply: async (text) => { replies.push(text); },
    });

    expect(replies[0]).toContain("Your Telegram user id: 111 (@alice)");
  });

  test("falls back to generic idLine when identityLabel omitted", async () => {
    const replies: string[] = [];
    await service.issueChallenge({
      channelId: "discord",
      identity: "abc#1234",
      sendReply: async (text) => { replies.push(text); },
    });

    expect(replies[0]).toContain("Your discord id: abc#1234");
  });

  test("emits pairing.request.created on creation", async () => {
    const events: string[] = [];
    eventBus.subscribe((e) => { events.push(e.type); });

    await service.issueChallenge({
      channelId: "telegram",
      identity: "999",
      sendReply: async () => {},
    });

    expect(events).toContain("pairing.request.created");
  });

  test("does NOT emit event for repeat sender", async () => {
    await service.issueChallenge({
      channelId: "telegram",
      identity: "999",
      sendReply: async () => {},
    });

    const events: string[] = [];
    eventBus.subscribe((e) => { events.push(e.type); });

    await service.issueChallenge({
      channelId: "telegram",
      identity: "999",
      sendReply: async () => {},
    });

    expect(events).not.toContain("pairing.request.created");
  });
});

describe("PairingService.approveRequest", () => {
  test("approve valid code adds identity to allowlist and emits pairing.request.approved", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    eventBus.subscribe((e) => { events.push({ type: e.type, payload: (e as { payload?: unknown }).payload }); });

    const { code } = await issueSingle(service, "telegram", "555");
    const result = service.approveRequest("telegram", code!);

    expect(result.approved).toBe(true);
    expect(result.identity).toBe("555");

    const allowlist = store.listAllowlistIdentities("telegram");
    expect(allowlist).toContain("555");

    expect(store.listRequests("telegram").length).toBe(0);
    expect(events.map((e) => e.type)).toContain("pairing.request.approved");
  });

  test("approve invalid/unknown code returns { approved: false } with no state change", async () => {
    await issueSingle(service, "telegram", "777");

    const result = service.approveRequest("telegram", "BADCODE");

    expect(result.approved).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(store.listAllowlistIdentities("telegram")).toHaveLength(0);
    expect(store.listRequests("telegram")).toHaveLength(1);
  });
});

describe("PairingService.revoke", () => {
  test("removes identity from allowlist and emits pairing.allowlist.removed", async () => {
    const { code } = await issueSingle(service, "telegram", "321");
    service.approveRequest("telegram", code!);

    const events: string[] = [];
    eventBus.subscribe((e) => { events.push(e.type); });

    service.revoke("telegram", "321");

    expect(store.listAllowlistIdentities("telegram")).toHaveLength(0);
    expect(events).toContain("pairing.allowlist.removed");
  });
});

describe("PairingService multi-channel isolation", () => {
  test("pairing request for channel A does not appear in channel B", async () => {
    await issueSingle(service, "discord", "user1");

    const telegramRequests = service.listRequests("telegram");
    expect(telegramRequests).toHaveLength(0);

    const discordRequests = service.listRequests("discord");
    expect(discordRequests).toHaveLength(1);
  });

  test("approving in channel A does not pollute channel B allowlist", async () => {
    const { code } = await issueSingle(service, "discord", "user2");
    service.approveRequest("discord", code!);

    expect(service.listAllowlist("telegram")).toHaveLength(0);
    expect(service.listAllowlist("discord")).toContain("user2");
  });
});

/** Helper: issue a single challenge and extract the code. */
async function issueSingle(
  svc: PairingService,
  channelId: string,
  identity: string,
): Promise<{ code: string | undefined }> {
  const result = await svc.issueChallenge({
    channelId,
    identity,
    sendReply: async () => {},
  });
  return { code: result.code };
}
