/**
 * Drift contract test for backend ↔ frontend `GhostErrorType` unions.
 *
 * The frontend mirrors the backend union manually (the web bundle doesn't
 * cross the Bun/Vite package boundary cleanly — see comment on
 * `web/src/lib/inline-error-text.ts`). This test parses the backend
 * source for the union literal and asserts every value:
 *   1. is a known frontend type per `isKnownErrorType`
 *   2. has a non-empty Ghost-voice mapping in `inlineErrorText`
 *
 * If the backend adds a new code, this test fails before runtime drift
 * surfaces in `console.warn` from `useChatEvents.ts`.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  inlineErrorText,
  isKnownErrorType,
  type GhostErrorType,
} from "../../web/src/lib/inline-error-text.js";

const BACKEND_ERRORS_SOURCE = join(
  import.meta.dir,
  "..",
  "..",
  "src",
  "core",
  "errors.ts",
);

/** Extract the string literal members of `export type GhostErrorType = "..." | "..."`. */
function readBackendErrorTypeUnion(): string[] {
  const source = readFileSync(BACKEND_ERRORS_SOURCE, "utf8");
  const match = source.match(
    /export\s+type\s+GhostErrorType\s*=\s*([\s\S]*?);/m,
  );
  if (!match) {
    throw new Error(
      `Could not locate \`export type GhostErrorType = ...\` in ${BACKEND_ERRORS_SOURCE}`,
    );
  }
  const body = match[1];
  const literals = body.match(/"([A-Z_]+)"/g);
  if (!literals || literals.length === 0) {
    throw new Error(
      `No string-literal members found in GhostErrorType: ${body}`,
    );
  }
  return literals.map((s) => s.replace(/"/g, ""));
}

describe("GhostErrorType drift contract (backend ↔ frontend)", () => {
  const backendCodes = readBackendErrorTypeUnion();

  test("backend union has at least one entry", () => {
    expect(backendCodes.length).toBeGreaterThan(0);
  });

  test("every backend code is a known frontend type", () => {
    const unknown: string[] = [];
    for (const code of backendCodes) {
      if (!isKnownErrorType(code)) unknown.push(code);
    }
    expect(unknown).toEqual([]);
  });

  test("every backend code has a non-empty inlineErrorText mapping", () => {
    const empty: string[] = [];
    for (const code of backendCodes) {
      const out = inlineErrorText(code as GhostErrorType);
      if (typeof out !== "string" || out.length === 0) empty.push(code);
    }
    expect(empty).toEqual([]);
  });

  test("isKnownErrorType rejects unknown values", () => {
    expect(isKnownErrorType("BILLING_REQUIRED")).toBe(false);
    expect(isKnownErrorType(undefined)).toBe(false);
    expect(isKnownErrorType(null)).toBe(false);
    expect(isKnownErrorType(42)).toBe(false);
    expect(isKnownErrorType("")).toBe(false);
  });

  test("isKnownErrorType accepts every backend code", () => {
    for (const code of backendCodes) {
      expect(isKnownErrorType(code)).toBe(true);
    }
  });
});
