/**
 * Tests for the chat.error routing invariant — verify that *every* errorType
 * (including AUTH_FAILED, CONTEXT_OVERFLOW, and missing/undefined) routes to
 * an inline assistant `type: 'error'` bubble whose `content` equals
 * `inlineErrorText(errorType)`. The banner branch for session-level errors
 * was removed per user feedback; the top banner is now
 * reserved for the websocket-disconnect state only.
 *
 * The routing lives inside `useChatEvents.ts` and resolves the friendly copy
 * at the edge by calling `inlineErrorText(errorType)` — the render layer
 * (`MessageBubble`) just displays `content`. We re-implement the branch here
 * as a pure function to give the rule a unit-test surface without standing
 * up React/JSDOM.
 */

import { describe, test, expect } from "bun:test";
import {
  inlineErrorText,
  type GhostErrorType,
} from "../../web/src/lib/inline-error-text.js";

type Surface = "inline";

interface RoutedError {
  surface: Surface;
  content: string;
}

/**
 * Mirrors the routing branch in useChatEvents.ts `case 'chat.error'`.
 * Returns the surface + the content string the bubble would display
 * (produced by `inlineErrorText(errorType)`).
 */
function classifyError(errorType: GhostErrorType | undefined): RoutedError {
  return { surface: "inline", content: inlineErrorText(errorType) };
}

describe("chat.error always routes to an inline bubble with friendly content", () => {
  test("AUTH_FAILED → inline (no banner)", () => {
    const r = classifyError("AUTH_FAILED");
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText("AUTH_FAILED"));
    expect(r.content).toContain("API key");
  });

  test("CONTEXT_OVERFLOW → inline (no banner)", () => {
    const r = classifyError("CONTEXT_OVERFLOW");
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText("CONTEXT_OVERFLOW"));
    expect(r.content).toContain("new session");
  });

  test("RATE_LIMITED → inline", () => {
    const r = classifyError("RATE_LIMITED");
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText("RATE_LIMITED"));
    expect(r.content).toContain("rate-limited");
  });

  test("PROVIDER_DOWN → inline", () => {
    const r = classifyError("PROVIDER_DOWN");
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText("PROVIDER_DOWN"));
    expect(r.content).toContain("reach the model");
  });

  // TOOL_BLOCKED no longer routes through `chat.error` — see Path C
  // (gateway emits a synthesized assistant text turn instead). The
  // `inlineErrorText` map still defines a fallback string in case the
  // gateway ever emits chat.error for TOOL_BLOCKED.
  test("TOOL_BLOCKED inline fallback string is in Ghost's voice", () => {
    expect(inlineErrorText("TOOL_BLOCKED")).toContain("security policy");
  });

  test("UNKNOWN → inline", () => {
    const r = classifyError("UNKNOWN");
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText("UNKNOWN"));
    expect(r.content).toBe("Something tripped me up — mind retrying?");
  });

  test("missing/undefined errorType falls back to inline UNKNOWN copy", () => {
    const r = classifyError(undefined);
    expect(r.surface).toBe("inline");
    expect(r.content).toBe(inlineErrorText(undefined));
    expect(r.content).toBe("Something tripped me up — mind retrying?");
  });
});
