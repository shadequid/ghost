/**
 * Shared web-side number formatters.
 *
 * Consolidates the previously-duplicated compact-USD helpers from
 * `PortfolioWidget.tsx` (`formatUsdCompact`) and `WalletManager.tsx`
 * (`formatUsdShort`).
 */

/**
 * Compact USD format for tight display cells.
 *
 * Format rules (canonical):
 * - NaN / Infinity    → `$—` (safe placeholder)
 * - `|v| >= $1M`      → `$X.XXM`
 * - `|v| >= threshold`→ `$X.XXk` (lowercase k, trailing `.00` stripped)
 * - `|v| >= $1k` (but below `threshold` when threshold > 1k) → `$X,XXX` (integer w/ commas)
 * - `|v| < $1k`       → `$X.XX`
 *
 * Negatives preserve sign: `-$77.78k`.
 *
 * `threshold` (default `1_000`) controls when the `k` suffix kicks in.
 * Pass a higher value (e.g. `10_000`) to keep mid-range values rendered
 * as integers with thousands separators.
 */
export function formatUsdCompact(v: number, threshold = 1_000): string {
  if (!Number.isFinite(v)) return '$—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= Math.max(threshold, 1_000)) {
    return `${sign}$${(abs / 1_000).toFixed(2).replace(/\.00$/, '')}k`;
  }
  if (abs >= 1_000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Compact signed PnL, e.g. `+$77.78k` / `-$12.50k`. Always prefixes sign. */
export function formatPnlCompact(v: number, threshold = 1_000): string {
  if (!Number.isFinite(v)) return '$—';
  const prefix = v >= 0 ? '+' : '-';
  return `${prefix}${formatUsdCompact(Math.abs(v), threshold)}`;
}

/**
 * Magnitude-aware USD format. Mirrors the server's `helpers/formatters.ts:formatUsd`
 * so any render surface that displays a price (Telegram body, web bell-dropdown,
 * chat history) produces the same string for the same number.
 *
 * - `|v| >= $1M`        → `$X.XXM`
 * - `|v| >= $1k`        → `$X,XXX.XX`
 * - `|v| >= $1` (or 0)  → `$X.XX`
 * - `|v| >= $0.0001`    → `$X.XXXX`
 * - else                → `$X.XXXXXX`
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) {
    const int = Math.trunc(value);
    const dec = Math.abs(value - int).toFixed(2).slice(1);
    const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `$${intStr}${dec}`;
  }
  if (abs >= 1 || value === 0) return `$${value.toFixed(2)}`;
  if (abs >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}
