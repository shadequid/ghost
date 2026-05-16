// Split a canonical symbol into its dex prefix (HIP-3) and base name.
// "xyz:WTIOIL" → { dex: "xyz", base: "WTIOIL" }
// "BTC"        → { dex: null,  base: "BTC" }
export function splitSymbol(sym: string): { dex: string | null; base: string } {
  const colon = sym.indexOf(':');
  if (colon === -1) return { dex: null, base: sym };
  return { dex: sym.slice(0, colon), base: sym.slice(colon + 1) };
}
