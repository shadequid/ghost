/**
 * BaseChannel.isAllowed — allowlist matching.
 *
 * The allowlist source (PairingStore) is faked here by overriding
 * `getAllowList()` directly so this suite focuses on matching rules:
 *   - `*` allows any id/username
 *   - numeric id match
 *   - username match: `@alice` and `alice` both work, case-insensitive
 *   - no match → false + debug log fired
 *   - both id and username passed — first match wins
 */

import { describe, it, expect, mock } from "bun:test";
import { BaseChannel } from "../../src/channels/base.js";
import { MessageBus } from "../../src/bus/queue.js";
import type { OutboundMessage } from "../../src/bus/types.js";
import type { Logger } from "pino";
import type { PairingStore } from "../../src/pairing/store.js";

// TestChannel overrides getAllowList directly, so pairingStore is never read.
const STUB_PAIRING = {} as PairingStore;

class TestChannel extends BaseChannel {
  readonly name = "test";
  readonly displayName = "Test";
  constructor(private readonly allowList: string[], bus: MessageBus, logger: Logger) {
    super({}, bus, logger, STUB_PAIRING);
  }
  protected override getAllowList(): string[] {
    return [...this.allowList];
  }
  async start(): Promise<void> { this._running = true; }
  async stop(): Promise<void> { this._running = false; }
  async send(_msg: OutboundMessage): Promise<void> {}
}

function makeLogger() {
  const debug = mock(() => {});
  const warn = mock(() => {});
  const logger = { debug, warn, info: () => {}, error: () => {}, trace: () => {}, fatal: () => {}, child: () => logger } as unknown as Logger;
  return { logger, debug, warn };
}

function makeChannel(allowList: string[]) {
  const { logger, debug, warn } = makeLogger();
  const ch = new TestChannel(allowList, new MessageBus(), logger);
  return { ch, debug, warn };
}

describe("BaseChannel.isAllowed", () => {
  it("`*` matches any numeric id", () => {
    const { ch } = makeChannel(["*"]);
    expect(ch.isAllowed("123456")).toBe(true);
    expect(ch.isAllowed({ id: "999", username: "anyone" })).toBe(true);
  });

  it("`*` matches any username-only identity", () => {
    const { ch } = makeChannel(["*"]);
    expect(ch.isAllowed({ id: "42", username: "randomuser" })).toBe(true);
  });

  it("numeric id match works", () => {
    const { ch } = makeChannel(["12345678"]);
    expect(ch.isAllowed("12345678")).toBe(true);
    expect(ch.isAllowed({ id: "12345678", username: "alice" })).toBe(true);
  });

  it("username with leading `@` matches", () => {
    const { ch } = makeChannel(["@alice"]);
    expect(ch.isAllowed({ id: "1", username: "alice" })).toBe(true);
  });

  it("username without leading `@` matches", () => {
    const { ch } = makeChannel(["alice"]);
    expect(ch.isAllowed({ id: "1", username: "alice" })).toBe(true);
  });

  it("username match is case-insensitive (config Alice vs actual alice)", () => {
    const { ch } = makeChannel(["Alice"]);
    expect(ch.isAllowed({ id: "1", username: "alice" })).toBe(true);
  });

  it("username match is case-insensitive (config alice vs actual Alice)", () => {
    const { ch } = makeChannel(["alice"]);
    expect(ch.isAllowed({ id: "1", username: "Alice" })).toBe(true);
  });

  it("`@Alice` matches `alice` (both strip + lowercase)", () => {
    const { ch } = makeChannel(["@Alice"]);
    expect(ch.isAllowed({ id: "1", username: "alice" })).toBe(true);
  });

  it("no match → returns false AND emits a debug log", () => {
    const { ch, debug } = makeChannel(["@alice"]);
    const ok = ch.isAllowed({ id: "999", username: "mallory" });
    expect(ok).toBe(false);
    expect(debug).toHaveBeenCalledTimes(1);
    const args = debug.mock.calls[0] as unknown[];
    const meta = args[0] as {
      channel: string;
      senderId: string;
      senderUsername?: string;
      allowList: string[];
    };
    expect(meta.channel).toBe("test");
    expect(meta.senderId).toBe("999");
    expect(meta.senderUsername).toBe("mallory");
    expect(meta.allowList).toEqual(["@alice"]);
  });

  it("empty allowList → denied (silent: pairing layer warns loudly instead)", () => {
    const { ch } = makeChannel([]);
    expect(ch.isAllowed("123")).toBe(false);
  });

  it("both id and username pass — id match wins first (still true)", () => {
    const { ch } = makeChannel(["12345"]);
    expect(ch.isAllowed({ id: "12345", username: "alice" })).toBe(true);
  });

  it("both id and username pass — username match works when id is not in list", () => {
    const { ch } = makeChannel(["@alice"]);
    expect(ch.isAllowed({ id: "99", username: "alice" })).toBe(true);
  });

  it("bare string identity still works (back-compat)", () => {
    const { ch } = makeChannel(["42"]);
    expect(ch.isAllowed("42")).toBe(true);
    expect(ch.isAllowed("43")).toBe(false);
  });
});
