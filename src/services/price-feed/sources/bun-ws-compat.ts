/**
 * Bun WebSocket binaryType compatibility shim.
 *
 * Upstream `@nktkas/rews` (dep of `@nktkas/hyperliquid`) calls
 * `ws.binaryType = 'blob'` inside its reconnecting socket factory. Bun's
 * WebSocket only accepts `'nodebuffer'` / `'arraybuffer'` and throws
 * `SyntaxError: 'blob' is not a valid value for binaryType` — which the
 * lib then wraps as `ReconnectingWebSocketError`, making the socket
 * permanently unusable on Bun.
 *
 * The runtime semantics the lib needs ("give me raw binary data") is
 * already the Bun default, so silently dropping the `'blob'` set gives
 * the library what it wanted. Any other value still goes through.
 *
 * Applied once, idempotent. Import this module at the top of any file
 * that instantiates a Hyperliquid WS transport, before the transport is
 * constructed.
 *
 * GLOBAL SIDE EFFECT WARNING: this patches WebSocket.prototype and
 * therefore affects every `new WebSocket(...)` in the process. The shim
 * emits a one-time console.warn when a caller sets `binaryType = 'blob'`
 * so future code that genuinely wants Blob frames (to receive binary
 * data as Blob objects) surfaces the incompatibility as a log line
 * instead of silently misbehaving. Drop the shim once upstream
 * `@nktkas/rews` stops setting `'blob'` unconditionally on Bun — see
 * https://github.com/nktkas/hyperliquid for progress.
 */

type PatchedProto = WebSocket & { __ghostBlobSetterPatched?: true };

// Hoisted so the tests (see tests/services/price-feed/bun-ws-compat.test.ts)
// can assert the shim has been applied without reaching through to module-
// level state on every import.
export const BUN_WS_COMPAT_APPLIED = applyShim();

function applyShim(): boolean {
  const proto = globalThis.WebSocket?.prototype as PatchedProto | undefined;
  if (!proto || proto.__ghostBlobSetterPatched) return proto?.__ghostBlobSetterPatched === true;
  const desc = Object.getOwnPropertyDescriptor(proto, "binaryType");
  if (!desc?.set) return false;
  const originalSet = desc.set;
  Object.defineProperty(proto, "binaryType", {
    configurable: true,
    enumerable: desc.enumerable ?? false,
    get: desc.get,
    set(value: string) {
      if (value === "blob") {
        const g = globalThis as Record<string, unknown>;
        if (!g.__ghostBlobWarned) {
          g.__ghostBlobWarned = true;
          // eslint-disable-next-line no-console -- intentional one-time warning
          console.warn("[ghost] WebSocket.binaryType='blob' silently dropped (Bun compat shim — see src/services/price-feed/sources/bun-ws-compat.ts)");
        }
        return;
      }
      originalSet.call(this, value);
    },
  });
  Object.defineProperty(proto, "__ghostBlobSetterPatched", {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return true;
}
