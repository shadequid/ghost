/**
 * Tests for the duck-typed error serialization branch in ws-handler.ts.
 *
 * The ws-handler dispatches RPCs and, on rejection, serializes the error
 * via JSON.stringify(error.toJSON()) when the rejected value duck-types as
 * `{ toJSON: () => unknown }`. This lets domain errors (TelegramSetupError)
 * carry a stable `code` to the web client without leaking the implementation
 * detail of `Error.message` substring matching.
 *
 * H2: this branch was previously untested — a wrong toJSON implementation
 * could ship clean. We verify both the error shape and the wire encoding
 * the ws-handler produces.
 */

import { describe, test, expect } from "bun:test";
import { TelegramSetupError } from "../../src/gateway/channel-errors.js";
import { classifyTelegramError } from "../../src/channels/telegram/plugin.js";

/**
 * Mirror the exact serialization branch from ws-handler.ts (lines ~113-122):
 *
 *   const errObj = err as { toJSON?: () => unknown; message?: string };
 *   const msg = typeof errObj.toJSON === "function"
 *     ? JSON.stringify(errObj.toJSON())
 *     : (err as Error).message;
 *
 * Pulled into a helper so the test exercises the same branch the handler
 * does without spinning up a real WebSocket.
 */
function serializeRpcError(err: unknown): string {
  const errObj = err as { toJSON?: () => unknown; message?: string };
  return typeof errObj.toJSON === "function"
    ? JSON.stringify(errObj.toJSON())
    : (err as Error).message;
}

describe("ws-handler error serialization (H2)", () => {
  test("TelegramSetupError serializes via toJSON branch — wire payload starts with '{'", () => {
    const err = new TelegramSetupError(
      "telegram_unauthorized",
      "Bot token rejected",
    );
    const wire = serializeRpcError(err);

    expect(wire.startsWith("{")).toBe(true);

    const parsed = JSON.parse(wire) as { code?: string; message?: string };
    expect(parsed.code).toBe("telegram_unauthorized");
    expect(parsed.message).toBe("Bot token rejected");
  });

  test("preserves code through every TelegramSetupErrorCode variant", () => {
    const cases = [
      "telegram_invalid_token",
      "telegram_unauthorized",
      "telegram_unreachable",
      "telegram_already_registered",
      "telegram_unknown",
    ] as const;
    for (const code of cases) {
      const err = new TelegramSetupError(code, `msg for ${code}`);
      const wire = serializeRpcError(err);
      const parsed = JSON.parse(wire) as { code: string; message: string };
      expect(parsed.code).toBe(code);
      expect(parsed.message).toBe(`msg for ${code}`);
    }
  });

  test("plain Error falls back to message — no JSON envelope", () => {
    const err = new Error("plain old error");
    const wire = serializeRpcError(err);
    expect(wire).toBe("plain old error");
    expect(wire.startsWith("{")).toBe(false);
  });

  test("toJSON return shape stays stable — only { code, message } keys", () => {
    // Web client maps `code` -> localized copy and falls back to `message`.
    // Adding fields here is fine, but removing or renaming either of these
    // two keys is a wire-protocol break.
    const err = new TelegramSetupError("telegram_unreachable", "Couldn't reach Telegram");
    const json = err.toJSON();
    expect(json).toEqual({
      code: "telegram_unreachable",
      message: "Couldn't reach Telegram",
    });
  });

  test("classifyTelegramError + TelegramSetupError round-trip survives serialization", () => {
    // Real path the gateway uses: classify a redacted message, throw, then
    // ws-handler serializes. Verify the code the UI receives matches what
    // classifyTelegramError produced.
    const code = classifyTelegramError("fetch failed: ECONNREFUSED");
    expect(code).toBe("telegram_unreachable");
    const err = new TelegramSetupError(code, "Couldn't reach Telegram");
    const wire = serializeRpcError(err);
    const parsed = JSON.parse(wire) as { code: string };
    expect(parsed.code).toBe("telegram_unreachable");
  });
});
