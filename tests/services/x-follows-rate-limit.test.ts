/**
 * Unit tests for X rate-limit handling: XRateLimitError + parseRetryAfter.
 *
 * The wider fetchAll / fetchFollowingAccountsTweets flow involves auth, an
 * SQLite DB, and network GraphQL calls, so it's exercised manually in the
 * daemon-integration smoke path rather than here. These tests cover just
 * the pure functions that decide "how long should the daemon wait before
 * the next cycle" — the piece most likely to regress.
 */

import { describe, expect, test } from "bun:test";
import { XRateLimitError, parseRetryAfter } from "../../src/services/x-follows.js";

describe("XRateLimitError", () => {
  test("carries retryAfterMs and preserves message", () => {
    const err = new XRateLimitError("rate limited", 45_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("XRateLimitError");
    expect(err.message).toBe("rate limited");
    expect(err.retryAfterMs).toBe(45_000);
  });

  test("instanceof check works across throw/catch boundary", () => {
    try {
      throw new XRateLimitError("x", 1000);
    } catch (e) {
      expect(e instanceof XRateLimitError).toBe(true);
    }
  });
});

describe("parseRetryAfter", () => {
  test("integer seconds → milliseconds", () => {
    expect(parseRetryAfter("60")).toBe(60_000);
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter("1")).toBe(1_000);
  });

  test("integer with whitespace still parses", () => {
    expect(parseRetryAfter("  30  ")).toBe(30_000);
  });

  test("HTTP-date → diff from now (approx)", () => {
    const future = new Date(Date.now() + 45_000);
    const ms = parseRetryAfter(future.toUTCString());
    // Allow small skew for the nanoseconds between new Date() and parseRetryAfter()
    expect(ms).toBeGreaterThan(40_000);
    expect(ms).toBeLessThanOrEqual(45_000);
  });

  test("HTTP-date in the past clamps to 0", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  test("null header → fallback (default 60 000)", () => {
    expect(parseRetryAfter(null)).toBe(60_000);
  });

  test("null header with custom fallback", () => {
    expect(parseRetryAfter(null, 5_000)).toBe(5_000);
  });

  test("garbage string → fallback", () => {
    expect(parseRetryAfter("not a number", 7_000)).toBe(7_000);
    expect(parseRetryAfter("", 3_000)).toBe(3_000);
  });

  test("negative integer → fallback (nonsensical wait)", () => {
    // "-5" parses as -5 seconds — treat as malformed and use fallback
    expect(parseRetryAfter("-5", 9_000)).toBe(9_000);
  });

  test("zero integer → fallback (treat as absent)", () => {
    // "0" technically means 'retry immediately'; our fallback is safer
    // because a source saying 0 usually means it forgot to set the header
    expect(parseRetryAfter("0", 11_000)).toBe(11_000);
  });

  test("mixed alphanumeric (e.g. '30s') → fallback", () => {
    // Retry-After is defined as an integer OR an HTTP-date, not suffixed
    // units. parseInt would accept "30s" but we must reject so we don't
    // silently misread other malformed headers.
    expect(parseRetryAfter("30s", 13_000)).toBe(13_000);
  });
});
