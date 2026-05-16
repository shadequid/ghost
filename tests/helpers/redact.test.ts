import { describe, test, expect } from "bun:test";
import { redactToken } from "../../src/helpers/redact.js";
import { redactBotToken } from "../../src/logger.js";

describe("redactToken", () => {
  test("strips raw token from message", () => {
    const token = "12345:ABC_secret";
    const msg = `oops, leaked: ${token} in error`;
    expect(redactToken(msg, token)).toBe("oops, leaked: [REDACTED] in error");
  });

  test("strips URL-encoded token", () => {
    const token = "12345:ABC secret/value";
    const encoded = encodeURIComponent(token);
    expect(redactToken(`url: https://x/bot${encoded}/getMe`, token))
      .toBe("url: https://x/bot[REDACTED]/getMe");
  });

  test("strips both raw and encoded forms", () => {
    const token = "9:abc def";
    const encoded = encodeURIComponent(token);
    const msg = `raw=${token} encoded=${encoded}`;
    const out = redactToken(msg, token);
    expect(out).not.toContain(token);
    expect(out).not.toContain(encoded);
    expect(out.match(/\[REDACTED\]/g)?.length ?? 0).toBe(2);
  });

  test("no-op on empty token", () => {
    expect(redactToken("hello", "")).toBe("hello");
  });

  test("no-op when token absent from message", () => {
    expect(redactToken("clean message", "secret")).toBe("clean message");
  });
});

// ---------------------------------------------------------------------------
// redactBotToken — pino serializer helper
// ---------------------------------------------------------------------------

describe("redactBotToken", () => {
  const TOKEN = "123456789:ABCdef-ghijkLMNOP_qrstUVWX012345";

  test("redacts token in Telegram API URL (bot<TOKEN>/ form)", () => {
    const msg = `Error: POST https://api.telegram.org/bot${TOKEN}/getMe failed`;
    const out = redactBotToken(msg);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("bot<redacted>");
  });

  test("redacts bare token form", () => {
    const msg = `token=${TOKEN} leaked`;
    const out = redactBotToken(msg);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("<redacted>");
  });

  test("no-op on strings without tokens", () => {
    const msg = "no token here, just a normal error";
    expect(redactBotToken(msg)).toBe(msg);
  });

  test("no-op on short numeric:string that doesn't match token pattern", () => {
    // Must have ≥30 chars after the colon to match
    const short = "123:tooshort";
    expect(redactBotToken(short)).toBe(short);
  });

  test("redacts token in stack trace", () => {
    const stack = `Error: fetch failed\n    at bot${TOKEN}/sendMessage (node:internal)\n    at Channel.send`;
    const out = redactBotToken(stack);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("bot<redacted>");
  });
});
