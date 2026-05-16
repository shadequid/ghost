import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore } from "../../src/pairing/store.js";
import { CredentialStore } from "../../src/config/credentials.js";
import { SecretStore } from "../../src/config/secrets.js";
import { configSchema, type Config } from "../../src/config/schema.js";
import { saveConfig, loadConfig } from "../../src/config/loader.js";
import { MessageBus } from "../../src/bus/queue.js";
import { EventBus } from "../../src/bus/events.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import { MessageDispatcher } from "../../src/channels/dispatcher.js";
import { ChannelManager } from "../../src/channels/manager.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { BaseChannel } from "../../src/channels/base.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import { telegramPlugin, type ProbeResult } from "../../src/channels/telegram/plugin.js";
import type { GhostEvent } from "../../src/events/index.js";
import type { OutboundMessage } from "../../src/bus/types.js";

// FakeTelegramChannel tests don't exercise allowlist behavior — a stub
// pairingStore is sufficient; the harness wires the real one for plugin paths.
const STUB_PAIRING_FOR_FAKE = {
  listAllowlistIdentities: () => ["*"],
} as unknown as PairingStore;

// Override telegramPlugin's private probe() method so tests control
// setup/status success and failure without hitting the real Telegram API.
let probeImpl: (token: string) => Promise<ProbeResult> = async () => ({ ok: true, username: "ghost_bot" });
const fakeProbe = mock(async (token: string) => probeImpl(token));
(telegramPlugin as unknown as { probe: typeof fakeProbe }).probe = fakeProbe;

// Per-test substitution for `new TelegramChannel(...)` via module mock.
// Tests that drive `channels.setup` push a FakeTelegramChannel here; the
// mocked constructor returns it in place of the real grammY-backed channel.
let nextFakeChannel: BaseChannel | undefined;

const realTelegramModule = await import("../../src/channels/telegram/index.js");
// Snapshot the real class BEFORE mock.module() rebinds the export so the
// fall-through path doesn't recurse into MockTelegramChannelCtor.
const OriginalTelegramChannel = realTelegramModule.TelegramChannel;

// When nextFakeChannel is set, the constructor returns that fake; otherwise it
// falls through to the real grammY-backed class so unrelated tests in the same
// worker (which import TelegramChannel for construction) are not affected.
class MockTelegramChannelCtor {
  constructor(...args: unknown[]) {
    const fake = nextFakeChannel;
    nextFakeChannel = undefined;
    if (fake) return fake as unknown as object;
    const RealCtor = OriginalTelegramChannel as unknown as new (...a: unknown[]) => object;
    return new RealCtor(...args);
  }
}

mock.module("../../src/channels/telegram/index.js", () => ({
  ...realTelegramModule,
  TelegramChannel: MockTelegramChannelCtor,
}));

// Import gateway/channels.js AFTER the module mock so its `new TelegramChannel`
// resolves to our stub constructor.
const { registerChannelsMethods } = await import("../../src/gateway/channels.js");

class FakeTelegramChannel extends BaseChannel {
  readonly name = "telegram";
  readonly displayName = "Telegram";
  startCalls = 0;
  stopCalls = 0;
  startResolvedAt = 0;
  // When set, start() resolves only after this promise resolves — lets tests
  // observe whether the RPC returns BEFORE the long-poll completes.
  pollingGate?: Promise<void>;
  startShouldThrow?: Error;

  constructor(bus: MessageBus, pairingStore: PairingStore) {
    super({}, bus, NOOP_LOGGER, pairingStore);
  }

  async start(): Promise<void> {
    this.startCalls++;
    if (this.startShouldThrow) throw this.startShouldThrow;
    this._running = true;
    this.startResolvedAt = Date.now();
    // Pretend the long-poll continues in the background — start() itself
    // returns as soon as the bot is "ready" (matches the real channel's
    // resolve-on-ready semantics, not resolve-when-polling-stops).
    if (this.pollingGate) void this.pollingGate.catch(() => {});
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    this._running = false;
  }

  async send(_msg: OutboundMessage): Promise<void> {}
}

function makeCtx(overrides?: Partial<MethodContext>): MethodContext {
  return {
    clientId: "c1",
    sessionId: "s1",
    broadcast: () => {},
    emit: () => {},
    ...overrides,
  };
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

interface Harness {
  tmp: string;
  db: Database;
  config: Config;
  configPath: string;
  credentials: CredentialStore;
  pairingStore: PairingStore;
  bus: MessageBus;
  eventBus: EventBus;
  events: GhostEvent[];
  reg: MethodRegistry;
  dispatcher: MessageDispatcher;
  manager: ChannelManager;
}

async function buildHarness(
  probe: (token: string) => Promise<ProbeResult>,
): Promise<Harness> {
  // Wire the module-level mock to delegate to this test's probe fn.
  probeImpl = probe;

  const tmp = mkdtempSync(join(tmpdir(), "ghost-channels-test-"));
  const db = initDatabase(":memory:");
  const config = configSchema.parse({});
  const configPath = join(tmp, "config.json");
  // Persist a baseline so saveConfig + loadConfig roundtrips work.
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const secretStore = new SecretStore(join(tmp, ".secret_key"));
  const credentials = new CredentialStore(join(tmp, "credentials.json"), secretStore, NOOP_LOGGER);
  const pairingStore = new PairingStore(db, NOOP_LOGGER);
  const bus = new MessageBus();
  const eventBus = new EventBus(NOOP_LOGGER);
  const events: GhostEvent[] = [];
  eventBus.subscribe((e) => events.push(e));
  const manager = new ChannelManager({ logger: NOOP_LOGGER });
  const dispatcher = makeDispatcher(bus, manager);
  const reg = new MethodRegistry();

  const mockPairingService = { issueChallenge: async () => ({ created: false }), approveRequest: (ch: string, code: string) => { const r = pairingStore.approveRequest(ch, code); return r ? { approved: true as const, identity: r.id } : { approved: false as const, identity: undefined }; }, revoke: (ch: string, id: string) => pairingStore.removeAllowlist(ch, id), listRequests: (ch: string) => pairingStore.listRequests(ch), listAllowlist: (ch: string) => pairingStore.listAllowlistIdentities(ch) } as unknown as import("../../src/pairing/service.js").PairingService;
  registerChannelsMethods(reg.register.bind(reg), {
    config,
    credentials,
    pairingStore,
    pairingService: mockPairingService,
    dispatcher,
    bus,
    eventBus,
    approvalManager: new ApprovalManager(),
    manager,
    // Stubbed services — none of the channels.test.ts cases exercise the
    // slash-command paths, so empty placeholders pass typecheck without
    // coupling the test to the real trading/news surface area.
    commandServices: {
      tradingClient: {} as never,
      walletStore: {} as never,
      newsService: {} as never,
      alertRules: {} as never,
      priceCache: {} as never,
    },
    logger: NOOP_LOGGER,
  });

  return { tmp, db, config, configPath, credentials, pairingStore, bus, eventBus, events, reg, dispatcher, manager };
}

describe("gateway/channels methods", () => {
  let h: Harness;

  afterEach(() => {
    h?.db.close();
    if (h?.tmp) rmSync(h.tmp, { recursive: true, force: true });
    nextFakeChannel = undefined;
  });

  describe("channels.list", () => {
    test("includes Telegram with disabled summary by default", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const res = await h.reg.dispatch("channels.list", makeCtx(), {}) as {
        channels: Array<{ id: string; enabled: boolean; running: boolean; label: string }>;
      };
      const tg = res.channels.find((c) => c.id === "telegram");
      expect(tg).toBeDefined();
      expect(tg!.enabled).toBe(false);
      expect(tg!.running).toBe(false);
      expect(tg!.label).toBe("Telegram");
    });
  });

  describe("channels.status", () => {
    test("returns disconnected state when not configured", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const res = await h.reg.dispatch("channels.status", makeCtx(), {}) as {
        enabled: boolean; running: boolean; pendingCount: number;
      };
      expect(res.enabled).toBe(false);
      expect(res.running).toBe(false);
      expect(res.pendingCount).toBe(0);
    });

    test("includes pendingCount from PairingStore", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      h.pairingStore.upsertRequest({ channel: "telegram", senderId: "111" });
      h.pairingStore.upsertRequest({ channel: "telegram", senderId: "222" });
      const res = await h.reg.dispatch("channels.status", makeCtx(), {}) as {
        pendingCount: number;
      };
      expect(res.pendingCount).toBe(2);
    });
  });

  describe("channels.setup — validation", () => {
    test("rejects empty token", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      let err: unknown;
      try { await h.reg.dispatch("channels.setup", makeCtx(), { token: "" }); }
      catch (e) { err = e; }
      expect((err as Error).message).toBe("token is required");
    });

    test("rejects non-string token", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      let err: unknown;
      try { await h.reg.dispatch("channels.setup", makeCtx(), { token: 42 }); }
      catch (e) { err = e; }
      expect((err as Error).message).toBe("token is required");
    });

    test("propagates probe rejection without persisting", async () => {
      h = await buildHarness(async () => ({ ok: false, error: "Unauthorized" }));
      let err: unknown;
      try { await h.reg.dispatch("channels.setup", makeCtx(), { token: "bad-token" }); }
      catch (e) { err = e; }
      expect((err as Error).message).toContain("Unauthorized");

      // No token saved.
      expect(await h.credentials.has("telegram_token")).toBe(false);
      // No state event emitted.
      expect(h.events.find((e) => e.type === "channel.state.changed")).toBeUndefined();
    });
  });

  describe("channels.remove", () => {
    test("always removes the token (remove is always hard)", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      // Pretend a previous setup left a token.
      await h.credentials.set("telegram_token", "abc:xyz");
      saveConfig(h.config, h.configPath);

      const res = await h.reg.dispatch("channels.remove", makeCtx(), {}) as {
        ok: boolean;
      };
      expect(res.ok).toBe(true);

      // Token is always removed — remove is hard by design.
      expect(await h.credentials.has("telegram_token")).toBe(false);
      // Disconnected event fired.
      const stateEvt = h.events.find((e) => e.type === "channel.state.changed");
      expect(stateEvt).toBeDefined();
    });

    test("remove with no token still succeeds", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      saveConfig(h.config, h.configPath);

      const res = await h.reg.dispatch("channels.remove", makeCtx(), {}) as { ok: boolean };
      expect(res.ok).toBe(true);
    });
  });

  describe("channels.pairing.list", () => {
    test("returns shaped payload from PairingStore", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const r999 = h.pairingStore.upsertRequest({ channel: "telegram", senderId: "999", username: "alice" });
      if (r999.kind !== "created") throw new Error("expected created");
      const code = r999.code;

      const res = await h.reg.dispatch("channels.pairing.list", makeCtx(), {}) as {
        requests: Array<{ code: string; senderId: string; username: string | null; createdAt: number; expiresAt: number }>;
      };
      expect(res.requests.length).toBe(1);
      expect(res.requests[0]!.code).toBe(code);
      expect(res.requests[0]!.senderId).toBe("999");
      expect(res.requests[0]!.username).toBe("alice");
      expect(typeof res.requests[0]!.createdAt).toBe("number");
      expect(typeof res.requests[0]!.expiresAt).toBe("number");
    });
  });

  describe("channels.pairing.approve", () => {
    test("approves pending code, returns identity, skips notify when notify=false", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const r777a = h.pairingStore.upsertRequest({ channel: "telegram", senderId: "777", username: "bob" });
      if (r777a.kind !== "created") throw new Error("expected created");
      const code = r777a.code;

      const res = await h.reg.dispatch(
        "channels.pairing.approve",
        makeCtx(),
        { code, notify: false },
      ) as { ok: boolean; identity: string; notified: boolean };

      expect(res.ok).toBe(true);
      expect(res.identity).toBe("777");
      expect(res.notified).toBe(false);
      // Allowlist updated.
      const allow = h.pairingStore.listAllowlistIdentities("telegram");
      expect(allow).toContain("777");
    });

    test("returns ok=false reason=not_found for unknown code", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const res = await h.reg.dispatch(
        "channels.pairing.approve",
        makeCtx(),
        { code: "ZZZZZZZZ", notify: false },
      ) as { ok: boolean; reason?: string };
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("not_found");
    });

    test("rejects empty code", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      let err: unknown;
      try {
        await h.reg.dispatch("channels.pairing.approve", makeCtx(), { code: "" });
      } catch (e) { err = e; }
      expect((err as Error).message).toBe("code is required");
    });

    test("notify failure does not fail the approval", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      // No telegram_token in credentials → notifyApproval will throw.
      const r888 = h.pairingStore.upsertRequest({ channel: "telegram", senderId: "888" });
      if (r888.kind !== "created") throw new Error("expected created");
      const code = r888.code;

      const res = await h.reg.dispatch(
        "channels.pairing.approve",
        makeCtx(),
        { code, notify: true },
      ) as { ok: boolean; notified: boolean; notifyError: string | null };

      expect(res.ok).toBe(true);
      expect(res.notified).toBe(false);
      expect(res.notifyError).not.toBeNull();
    });
  });

  describe("channels.allowlist.list", () => {
    test("returns shaped entries from PairingStore", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      h.pairingStore.setAllowlist("telegram", ["alice", "12345"]);

      const res = await h.reg.dispatch("channels.allowlist.list", makeCtx(), {}) as {
        entries: Array<{ identity: string; identityKind: "id" | "username"; addedAt: number }>;
      };
      expect(res.entries.length).toBe(2);
      const byId = new Map(res.entries.map((e) => [e.identity, e]));
      expect(byId.get("alice")?.identityKind).toBe("username");
      expect(byId.get("12345")?.identityKind).toBe("id");
      expect(typeof byId.get("alice")?.addedAt).toBe("number");
    });

    test("reflects identity added by approve", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const r777b = h.pairingStore.upsertRequest({ channel: "telegram", senderId: "777", username: "bob" });
      if (r777b.kind !== "created") throw new Error("expected created");
      const code = r777b.code;
      await h.reg.dispatch(
        "channels.pairing.approve",
        makeCtx(),
        { code, notify: false },
      );

      const res = await h.reg.dispatch("channels.allowlist.list", makeCtx(), {}) as {
        entries: Array<{ identity: string }>;
      };
      expect(res.entries.map((e) => e.identity)).toContain("777");
    });
  });

  describe("channels.allowlist.remove", () => {
    test("removes entry, returns ok=true and emits pairing.allowlist.removed", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      h.pairingStore.setAllowlist("telegram", ["alice"]);
      // Wire store events to eventBus via PairingService for the approval path.
      const { PairingEvents } = await import("../../src/events/pairing-events.js");
      const unsubscribe = h.pairingStore.onEvent((e) => {
        if (e.type === "allowlist_removed") {
          h.eventBus.publish(PairingEvents.allowlistRemoved({
            channel: e.channel,
            identity: e.identity,
          }));
        }
      });

      const res = await h.reg.dispatch(
        "channels.allowlist.remove",
        makeCtx(),
        { identity: "alice" },
      ) as { ok: boolean };
      expect(res.ok).toBe(true);
      expect(h.pairingStore.listAllowlistIdentities("telegram")).not.toContain("alice");
      const evt = h.events.find((e) => e.type === "pairing.allowlist.removed");
      expect(evt).toBeDefined();
      expect((evt as { payload: { channel: string; identity: string } }).payload.channel).toBe("telegram");
      expect((evt as { payload: { channel: string; identity: string } }).payload.identity).toBe("alice");

      unsubscribe();
    });

    test("returns ok=false for unknown identity (no throw, no event)", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      const res = await h.reg.dispatch(
        "channels.allowlist.remove",
        makeCtx(),
        { identity: "nobody" },
      ) as { ok: boolean };
      expect(res.ok).toBe(false);
      expect(h.events.find((e) => e.type === "pairing.allowlist.removed")).toBeUndefined();
    });

    test("rejects empty identity", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      let err: unknown;
      try {
        await h.reg.dispatch("channels.allowlist.remove", makeCtx(), { identity: "" });
      } catch (e) { err = e; }
      expect((err as Error).message).toBe("identity is required");
    });

    test("rejects non-string identity", async () => {
      h = await buildHarness(async () => ({ ok: true, username: "ghost_bot" }));
      let err: unknown;
      try {
        await h.reg.dispatch("channels.allowlist.remove", makeCtx(), { identity: 42 });
      } catch (e) { err = e; }
      expect((err as Error).message).toBe("identity is required");
    });
  });

  describe("channels.setup — success path", () => {
    test("RPC resolves before background polling completes (fire-and-forget start)", async () => {
      const bus = new MessageBus();
      const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
      // Polling never resolves on its own — emulating the real long-poll.
      // If the RPC awaited bot.start() it would hang forever.
      let releasePolling: () => void = () => {};
      fake.pollingGate = new Promise<void>((res) => { releasePolling = res; });
      nextFakeChannel = fake;

      h = await buildHarness(
        async () => ({ ok: true, username: "ghost_bot" }),
      );

      const res = await h.reg.dispatch("channels.setup", makeCtx(), { token: "123:abc" }) as {
        ok: boolean; summary: string;
      };

      expect(res.ok).toBe(true);
      expect(fake.startCalls).toBe(1);
      expect(fake.isRunning).toBe(true);
      // channel.state.changed event fires for live registration → dashboard
      // chip wakes up without polling status.
      const stateEvt = h.events.find((e) => e.type === "channel.state.changed");
      expect(stateEvt).toBeDefined();
      // Token persisted and channel is live.
      expect(await h.credentials.has("telegram_token")).toBe(true);
      // Dispatcher status reflects the live channel for status RPC.
      expect(h.manager.getStatus().telegram?.running).toBe(true);

      // Tear down so the test process doesn't dangle.
      releasePolling();
      await h.manager.removeChannel("telegram");
    });

  });

  describe("channels.setup — concurrency (serialized via per-id lock)", () => {
    test("two concurrent setup calls produce a single registration", async () => {
      const bus = new MessageBus();
      const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
      nextFakeChannel = fake;

      h = await buildHarness(
        async () => ({ ok: true, username: "ghost_bot" }),
      );

      const [a, b] = await Promise.allSettled([
        h.reg.dispatch("channels.setup", makeCtx(), { token: "t1" }),
        h.reg.dispatch("channels.setup", makeCtx(), { token: "t2" }),
      ]);

      const ok = [a, b].filter((r) => r.status === "fulfilled");
      const failed = [a, b].filter((r) => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(failed.length).toBe(1);
      // Exactly one channel.start() — the second call sees the first
      // already registered and rejects with a typed error.
      expect(fake.startCalls).toBe(1);
      const err = (failed[0] as PromiseRejectedResult).reason as Error;
      expect(err.message.toLowerCase()).toContain("already");

      await h.manager.removeChannel("telegram");
    });

    test("setup after disconnect succeeds (no stale state)", async () => {
      const bus = new MessageBus();
      const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
      nextFakeChannel = fake;

      h = await buildHarness(
        async () => ({ ok: true, username: "ghost_bot" }),
      );

      await h.reg.dispatch("channels.setup", makeCtx(), { token: "t1" });
      await h.reg.dispatch("channels.remove", makeCtx(), {});
      // Build a new fake for the second connect (real flow constructs fresh).
      const fake2 = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
      nextFakeChannel = fake2;
      h = await buildHarness(
        async () => ({ ok: true, username: "ghost_bot" }),
      );
      const res = await h.reg.dispatch("channels.setup", makeCtx(), { token: "t2" }) as {
        ok: boolean;
      };
      expect(res.ok).toBe(true);
      expect(fake2.startCalls).toBe(1);
      await h.manager.removeChannel("telegram");
    });
  });

  describe("channels.setup — token redaction", () => {
    test("probe error redacts token from message", async () => {
      const sensitiveToken = "999999:SECRET_BOT_TOKEN_VALUE";
      // Probe rejects with a fetch-style error that includes the token.
      h = await buildHarness(async () => ({
        ok: false,
        error: `fetch failed: timeout to https://api.telegram.org/bot${encodeURIComponent(sensitiveToken)}/getMe`,
      }));

      let err: unknown;
      try {
        await h.reg.dispatch("channels.setup", makeCtx(), { token: sensitiveToken });
      } catch (e) { err = e; }
      const msg = (err as Error).message;
      expect(msg).not.toContain(sensitiveToken);
      expect(msg).not.toContain(encodeURIComponent(sensitiveToken));
      expect(msg).toContain("[REDACTED]");
    });

    test("live-register failure redacts token from re-thrown message", async () => {
      const sensitiveToken = "888888:OTHER_SECRET_VALUE";
      const bus = new MessageBus();
      const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
      fake.startShouldThrow = new Error(
        `Conflict polling https://api.telegram.org/bot${encodeURIComponent(sensitiveToken)}/getUpdates`,
      );
      nextFakeChannel = fake;

      h = await buildHarness(
        async () => ({ ok: true, username: "ghost_bot" }),
      );

      let err: unknown;
      try {
        await h.reg.dispatch("channels.setup", makeCtx(), { token: sensitiveToken });
      } catch (e) { err = e; }
      const msg = (err as Error).message;
      expect(msg).not.toContain(sensitiveToken);
      expect(msg).not.toContain(encodeURIComponent(sensitiveToken));
    });
  });

  describe("channels.setup — typed error codes", () => {
    test("token-rejected probe yields telegram_unauthorized code", async () => {
      h = await buildHarness(async () => ({ ok: false, error: "Unauthorized" }));
      let err: unknown;
      try {
        await h.reg.dispatch("channels.setup", makeCtx(), { token: "bad" });
      } catch (e) { err = e; }
      // The gateway wraps probe rejections in TelegramSetupError; the WS
      // layer serializes via toJSON, but in-process dispatch surfaces the
      // raw Error — assert via the .code property.
      const tErr = err as Error & { code?: string };
      expect(tErr.code).toBe("telegram_unauthorized");
    });

    test("network failure yields telegram_unreachable code", async () => {
      h = await buildHarness(async () => ({ ok: false, error: "fetch failed: ConnectTimeout" }));
      let err: unknown;
      try {
        await h.reg.dispatch("channels.setup", makeCtx(), { token: "12345:ABC" });
      } catch (e) { err = e; }
      const tErr = err as Error & { code?: string };
      expect(tErr.code).toBe("telegram_unreachable");
    });
  });
});

describe("ChannelManager.addChannel — duplicate rejection", () => {
  test("throws ChannelAlreadyRegisteredError on duplicate name", async () => {
    const { ChannelAlreadyRegisteredError } = await import("../../src/channels/dispatcher.js");
    const bus = new MessageBus();
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    const a = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    const b = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);

    manager.addChannel(a);
    expect(() => manager.addChannel(b)).toThrow(ChannelAlreadyRegisteredError);
    // The original channel is still registered (no silent replace).
    expect(manager.getChannel("telegram")).toBe(a);
  });

  test("re-register succeeds after explicit removeChannel", async () => {
    const bus = new MessageBus();
    const manager = new ChannelManager({ logger: NOOP_LOGGER });
    const a = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    const b = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);

    manager.addChannel(a);
    await manager.removeChannel("telegram");
    manager.addChannel(b);
    expect(manager.getChannel("telegram")).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe("first-setup seeds config.telegram with Zod defaults", () => {
  let h: Harness;

  afterEach(() => {
    h?.db.close();
    if (h?.tmp) rmSync(h.tmp, { recursive: true, force: true });
    nextFakeChannel = undefined;
  });

  test("setup activates channel using schema-defaulted telegram config", async () => {
    const bus = new MessageBus();
    const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    nextFakeChannel = fake;

    h = await buildHarness(
      async () => ({ ok: true, username: "ghost_bot" }),
    );
    // config.telegram is always defaulted by the schema — no runtime seeding.
    expect(h.config.telegram).toBeDefined();
    expect(typeof h.config.telegram.reactEmoji).toBe("string");

    await h.reg.dispatch("channels.setup", makeCtx(), { token: "123:abc" });

    expect(h.manager.isActive("telegram")).toBe(true);

    await h.manager.removeChannel("telegram");
  });
});

describe("gateway shares the runtime ChannelManager (no local instance)", () => {
  let h: Harness;

  afterEach(() => {
    h?.db.close();
    if (h?.tmp) rmSync(h.tmp, { recursive: true, force: true });
    nextFakeChannel = undefined;
  });

  test("manager.isActive agrees with dispatcher after gateway setup", async () => {
    const bus = new MessageBus();
    const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    nextFakeChannel = fake;

    h = await buildHarness(
      async () => ({ ok: true, username: "ghost_bot" }),
    );

    await h.reg.dispatch("channels.setup", makeCtx(), { token: "123:abc" });

    // The harness passes h.manager into registerChannelsMethods — same instance
    // used here. Both views must agree that telegram is active.
    expect(h.manager.isActive("telegram")).toBe(true);
    expect(h.manager.getChannel("telegram")?.isRunning).toBe(true);

    await h.manager.removeChannel("telegram");
  });

  test("manager.isActive reflects removal after channels.remove", async () => {
    const bus = new MessageBus();
    const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    nextFakeChannel = fake;

    h = await buildHarness(
      async () => ({ ok: true, username: "ghost_bot" }),
    );

    await h.reg.dispatch("channels.setup", makeCtx(), { token: "123:abc" });
    expect(h.manager.isActive("telegram")).toBe(true);

    await h.reg.dispatch("channels.remove", makeCtx(), {});
    expect(h.manager.isActive("telegram")).toBe(false);
  });
});

describe("regression: H1 — concurrent setup serialized by lock", () => {
  let h: Harness;

  afterEach(() => {
    h?.db.close();
    if (h?.tmp) rmSync(h.tmp, { recursive: true, force: true });
    nextFakeChannel = undefined;
  });

  test("concurrent setup: one wins, one rejects; winning channel remains running", async () => {
    const bus = new MessageBus();
    const fake = new FakeTelegramChannel(bus, STUB_PAIRING_FOR_FAKE);
    nextFakeChannel = fake;

    h = await buildHarness(
      async () => ({ ok: true, username: "ghost_bot" }),
    );

    const [a, b] = await Promise.allSettled([
      h.reg.dispatch("channels.setup", makeCtx(), { token: "t1" }),
      h.reg.dispatch("channels.setup", makeCtx(), { token: "t2" }),
    ]);

    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const failed = [a, b].filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);

    // Winning channel must still be running after the losing call rejects (H1).
    expect(fake.isRunning).toBe(true);
    expect(h.manager.isActive("telegram")).toBe(true);

    await h.manager.removeChannel("telegram");
  });
});
