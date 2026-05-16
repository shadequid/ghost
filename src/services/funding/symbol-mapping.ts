import type { ProviderKey } from "./types.js";

/**
 * HL symbol → CEX-native symbol. Returns null when the HL token is not
 * representable on that CEX (e.g. permissionless RWA perps with no CEX
 * counterpart).
 *
 * Common HL k-prefix tokens (kPEPE, kBONK) map to "1000PEPE", "1000BONK"
 * on most CEX. Anything we can't map deterministically returns null;
 * callers downgrade to "missing" rather than guessing wrong.
 */
export function toCexSymbol(hlSymbol: string, exchange: ProviderKey): string | null {
  const trimmed = hlSymbol.trim();
  if (!trimmed) return null;

  // Detect k-prefix BEFORE uppercasing — toUpperCase destroys the casing signal
  // that distinguishes kAVA (HL unit-normalized meme) from KAVA (real token).
  // HL convention: lowercase 'k' + uppercase letter(s) = 1000x unit-normalised.
  const cleaned = /^k[A-Z]/.test(trimmed)
    ? `1000${trimmed.slice(1).toUpperCase()}`
    : trimmed.toUpperCase();

  switch (exchange) {
    case "binance":
    case "bybit":
      return `${cleaned}USDT`;
    case "okx":
      return `${cleaned}-USDT-SWAP`;
    default: {
      // Exhaustiveness guard — if ProviderKey gains a new value, this throws at runtime
      // rather than silently returning undefined.
      const _exhaustive: never = exchange;
      throw new Error(`unknown ProviderKey: ${_exhaustive}`);
    }
  }
}
