/**
 * Smoke tests for the Bun WebSocket binaryType compat shim.
 *
 * The shim is load-bearing for hl-ws connectivity on Bun. A regression
 * (Bun update changing the setter semantics, or an unrelated refactor
 * causing the shim to no-op) would silently break only hl-ws while
 * composite failover papers over the failure via Binance/REST. This test
 * turns that would-be silent failure into an explicit CI signal.
 */

import { describe, test, expect } from "bun:test";
import { BUN_WS_COMPAT_APPLIED } from "../../../src/services/price-feed/sources/bun-ws-compat.js";

describe("bun-ws-compat shim", () => {
  test("shim has been applied to WebSocket.prototype", () => {
    // Importing the module was enough to trigger applyShim(); the exported
    // flag reflects that same one-shot application.
    expect(BUN_WS_COMPAT_APPLIED).toBe(true);
    const proto = globalThis.WebSocket?.prototype as WebSocket & { __ghostBlobSetterPatched?: true };
    expect(proto.__ghostBlobSetterPatched).toBe(true);
  });

  test("binaryType = 'blob' is silently dropped (no throw) and non-blob values pass through", () => {
    // Instantiate a WebSocket but never allow the network connect to complete —
    // we only need the setter path, not a live peer. The URL points at an
    // unroutable host so Bun schedules a connect that will fail later.
    const ws = new WebSocket("ws://127.0.0.1:1"); // port 1 is reserved, connect will fail
    try {
      // Pre-patch, this would throw SyntaxError on Bun. Post-patch, it's a no-op.
      expect(() => { ws.binaryType = "blob"; }).not.toThrow();
      // Standard values still pass through to the real setter without error.
      expect(() => { ws.binaryType = "arraybuffer"; }).not.toThrow();
    } finally {
      try { ws.close(); } catch { /* ignore — socket may not have opened */ }
    }
  });
});
