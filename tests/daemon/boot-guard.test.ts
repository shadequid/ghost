/**
 * Regression test for the boot guard that rejects non-loopback host binding
 * unless gateway.allowPublicBind=true.
 *
 * Exercises the guard logic directly without spinning up the full daemon
 * (no network, no DB, no services).
 */

import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Extract guard logic under test — mirrors src/daemon/index.ts boot step 4.
// Kept here as a pure function so tests are hermetic (no runtime bootstrap).
// ---------------------------------------------------------------------------

function checkBootGuard(host: string, allowPublicBind: boolean): void {
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!isLoopback && !allowPublicBind) {
    throw new Error(
      `Gateway host "${host}" is not loopback and gateway.allowPublicBind is false. ` +
      `Set gateway.host to 127.0.0.1 OR set gateway.allowPublicBind=true to acknowledge the exposure.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("daemon boot guard", () => {
  describe("loopback hosts — always allowed regardless of allowPublicBind", () => {
    test("127.0.0.1 + allowPublicBind=false", () => {
      expect(() => checkBootGuard("127.0.0.1", false)).not.toThrow();
    });

    test("::1 + allowPublicBind=false", () => {
      expect(() => checkBootGuard("::1", false)).not.toThrow();
    });

    test("localhost + allowPublicBind=false", () => {
      expect(() => checkBootGuard("localhost", false)).not.toThrow();
    });

    test("127.0.0.1 + allowPublicBind=true", () => {
      expect(() => checkBootGuard("127.0.0.1", true)).not.toThrow();
    });
  });

  describe("non-loopback hosts — blocked unless allowPublicBind=true", () => {
    test("0.0.0.0 + allowPublicBind=false throws", () => {
      expect(() => checkBootGuard("0.0.0.0", false)).toThrow(
        /allowPublicBind is false/,
      );
    });

    test("0.0.0.0 + allowPublicBind=false error mentions the host", () => {
      expect(() => checkBootGuard("0.0.0.0", false)).toThrow(/"0\.0\.0\.0"/);
    });

    test("192.168.1.10 + allowPublicBind=false throws", () => {
      expect(() => checkBootGuard("192.168.1.10", false)).toThrow(
        /allowPublicBind is false/,
      );
    });

    test("10.0.0.1 + allowPublicBind=false throws", () => {
      expect(() => checkBootGuard("10.0.0.1", false)).toThrow(
        /allowPublicBind is false/,
      );
    });

    test("0.0.0.0 + allowPublicBind=true is allowed (explicit opt-in)", () => {
      expect(() => checkBootGuard("0.0.0.0", true)).not.toThrow();
    });

    test("192.168.1.10 + allowPublicBind=true is allowed (explicit opt-in)", () => {
      expect(() => checkBootGuard("192.168.1.10", true)).not.toThrow();
    });
  });

  describe("schema default is loopback + allowPublicBind=false (safe-by-default)", () => {
    test("fresh install defaults pass the guard", async () => {
      // Parse a minimal config and verify the defaults are loopback + no public bind.
      const { gatewaySchema } = await import("../../src/config/schema.js");
      const gw = gatewaySchema.parse({});
      expect(gw.host).toBe("127.0.0.1");
      expect(gw.allowPublicBind).toBe(false);
      expect(() => checkBootGuard(gw.host, gw.allowPublicBind)).not.toThrow();
    });
  });
});
