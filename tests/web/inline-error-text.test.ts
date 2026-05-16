/**
 * Tests for inlineErrorText — friendly English copy keyed by GhostErrorType.
 * Covers the inline chat error bubble + per-user-message retry surface.
 */

import { describe, test, expect } from "bun:test";
import { inlineErrorText } from "../../web/src/lib/inline-error-text.js";

describe("inlineErrorText (Ghost's voice — first-person, warm)", () => {
  test("RATE_LIMITED speaks in first person about being throttled", () => {
    const out = inlineErrorText("RATE_LIMITED");
    expect(out).toBe(
      "I'm being rate-limited right now — give me a moment and try again",
    );
    expect(out).toMatch(/^I'm /);
  });

  test("PROVIDER_DOWN speaks in first person about reach", () => {
    const out = inlineErrorText("PROVIDER_DOWN");
    expect(out).toBe(
      "I can't reach the model right now — looks like a connectivity hiccup",
    );
    expect(out).toMatch(/^I /);
  });

  test("TOOL_BLOCKED speaks in first person about the block", () => {
    const out = inlineErrorText("TOOL_BLOCKED");
    expect(out).toBe(
      "I can't run that — security policy is blocking it",
    );
    expect(out).toMatch(/^I /);
  });

  test("AUTH_FAILED speaks about the user's API key in second person", () => {
    const out = inlineErrorText("AUTH_FAILED");
    expect(out).toBe(
      "Your API key isn't working — please check it and I'll try again",
    );
    expect(out).toContain("API key");
  });

  test("CONTEXT_OVERFLOW uses 'we' to describe shared conversation length", () => {
    const out = inlineErrorText("CONTEXT_OVERFLOW");
    expect(out).toBe(
      "We've talked too much for me to keep track — let's start a new session",
    );
    expect(out).toMatch(/^We/);
  });

  test("UNKNOWN is a soft retry prompt in Ghost's voice", () => {
    expect(inlineErrorText("UNKNOWN")).toBe(
      "Something tripped me up — mind retrying?",
    );
  });

  test("undefined falls back to the same UNKNOWN copy", () => {
    expect(inlineErrorText(undefined)).toBe(
      "Something tripped me up — mind retrying?",
    );
  });

  test("no string reads like a system notice (no ALL CAPS, no 'ERROR:')", () => {
    const types = [
      "AUTH_FAILED",
      "RATE_LIMITED",
      "CONTEXT_OVERFLOW",
      "PROVIDER_DOWN",
      "TOOL_BLOCKED",
      "UNKNOWN",
    ] as const;
    for (const t of types) {
      const out = inlineErrorText(t);
      expect(out).not.toMatch(/\bERROR\b/);
      expect(out).not.toMatch(/\bFAILED\b/);
      expect(out).not.toMatch(/^[A-Z_]+:/);
    }
  });

  test("every output is a non-empty string", () => {
    const types = [
      "AUTH_FAILED",
      "RATE_LIMITED",
      "CONTEXT_OVERFLOW",
      "PROVIDER_DOWN",
      "TOOL_BLOCKED",
      "UNKNOWN",
    ] as const;
    for (const t of types) {
      const out = inlineErrorText(t);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
