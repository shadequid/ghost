/**
 * Custom UI tag stripping for the Telegram formatter.
 *
 * The web UI renders custom inline tags (<price>, <pnl>, <side>, …) natively;
 * Telegram does not, so we peel them off here. Separated from `telegram-format.ts`
 * to keep each module focused.
 */

import { SENTINEL_I_OPEN, SENTINEL_I_CLOSE, SENTINEL_B_OPEN, SENTINEL_B_CLOSE } from "./markdown.js";
import type { ChartSpec } from "../chart-renderer.js";

// ---------------------------------------------------------------------------
// S/R level formatter — used by the chart caption builder in index.ts.
// ---------------------------------------------------------------------------

/**
 * Format a CSV string of price levels into a human-readable list.
 * Values >= 1000 are shortened to `$Xk` (1 decimal if needed).
 * Non-numeric values are passed through as-is.
 * Returns empty string when input is empty or undefined.
 */
export function formatLevels(csv: string | undefined): string {
  if (!csv) return "";
  const parts = csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(formatOneLevel);
  return parts.length === 0 ? "" : parts.join(", ");
}

function formatOneLevel(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `$${k}k` : `$${k.toFixed(1)}k`;
  }
  return `$${raw}`;
}

// ---------------------------------------------------------------------------
// Chart extraction — runs BEFORE stripCustomTags so the dispatcher can
// send screenshots. Legacy callers that call format() directly still get
// the text hint from stripCustomTags (it finds nothing in happy path).
// ---------------------------------------------------------------------------

const CHART_RE_PAIRED = /<chart\s*([^>]*)>([\s\S]*?)<\/chart>/gi;
const CHART_RE_SELF = /<chart\s+([^>]*?)\/>/gi;

function parseChartAttrs(attrs: string): ChartSpec | null {
  const symMatch = /\bsymbol\s*=\s*"([^"]+)"/i.exec(attrs);
  const intMatch = /\binterval\s*=\s*"([^"]+)"/i.exec(attrs);
  if (!symMatch || !intMatch) return null;
  const indMatch = /\bindicators\s*=\s*"([^"]+)"/i.exec(attrs);
  const lvlMatch = /\blevels\s*=\s*"([^"]+)"/i.exec(attrs);
  return {
    symbol: symMatch[1],
    interval: intMatch[1],
    ...(indMatch ? { indicators: indMatch[1] } : {}),
    ...(lvlMatch ? { levels: lvlMatch[1] } : {}),
  };
}

/**
 * Extract all `<chart>` tags from `text`, returning the stripped text and
 * parsed specs. Invalid specs (missing symbol or interval) are skipped
 * silently. Runs BEFORE the rest of the format pipeline so screenshots
 * can be sent alongside prose.
 */
export function extractCharts(text: string): { text: string; charts: ChartSpec[] } {
  const charts: ChartSpec[] = [];
  // Paired form first: <chart ...>...</chart>
  let out = text.replace(CHART_RE_PAIRED, (_m, attrs: string) => {
    const spec = parseChartAttrs(attrs);
    if (spec) charts.push(spec);
    return "";
  });
  // Self-closing form: <chart ... />
  out = out.replace(CHART_RE_SELF, (_m, attrs: string) => {
    const spec = parseChartAttrs(attrs);
    if (spec) charts.push(spec);
    return "";
  });
  return { text: out, charts };
}

/** Custom inline tag replacements. Inner text is emitted raw (escaping handled later). */
export function stripCustomTags(text: string): string {
  let out = text;

  // <pnl dir="up|down|flat">X</pnl> — add emoji based on direction.
  out = out.replace(/<pnl\s+dir="up"\s*>([\s\S]*?)<\/pnl>/gi, "$1 📈");
  out = out.replace(/<pnl\s+dir="down"\s*>([\s\S]*?)<\/pnl>/gi, "$1 📉");
  out = out.replace(/<pnl\s+dir="flat"\s*>([\s\S]*?)<\/pnl>/gi, "$1");
  out = out.replace(/<pnl\s*>([\s\S]*?)<\/pnl>/gi, "$1");

  // <side dir="long|short">X</side>
  out = out.replace(/<side\s+dir="long"\s*>([\s\S]*?)<\/side>/gi, "🟢 $1");
  out = out.replace(/<side\s+dir="short"\s*>([\s\S]*?)<\/side>/gi, "🔴 $1");
  out = out.replace(/<side\s*[^>]*>([\s\S]*?)<\/side>/gi, "$1");

  // <tag type="entry|tp|sl">X</tag> — marker emoji prepended; label already
  // lives inside per SOUL.md contract so we only add a visual prefix.
  out = out.replace(/<tag\s+type="entry"\s*>([\s\S]*?)<\/tag>/gi, "🎯 $1");
  out = out.replace(/<tag\s+type="tp"\s*>([\s\S]*?)<\/tag>/gi, "💰 $1");
  out = out.replace(/<tag\s+type="sl"\s*>([\s\S]*?)<\/tag>/gi, "⛔ $1");
  out = out.replace(/<tag\s*[^>]*>([\s\S]*?)<\/tag>/gi, "$1");

  // <price>, <lev> — strip wrapper, keep inner.
  out = out.replace(/<price\s*>([\s\S]*?)<\/price>/gi, "$1");
  out = out.replace(/<lev\s*>([\s\S]*?)<\/lev>/gi, "$1");

  // <pct dir="up|down">X</pct> — directional emoji, consistent with <pnl>.
  out = out.replace(/<pct\s+dir="up"\s*>([\s\S]*?)<\/pct>/gi, "$1 📈");
  out = out.replace(/<pct\s+dir="down"\s*>([\s\S]*?)<\/pct>/gi, "$1 📉");
  out = out.replace(/<pct\s*[^>]*>([\s\S]*?)<\/pct>/gi, "$1");

  // <ind name="...">X</ind> — indicator hover; strip wrapper, keep inner.
  out = out.replace(/<ind\s*[^>]*>([\s\S]*?)<\/ind>/gi, "$1");

  // <lvl price="...">X</lvl> — price-level hover; keep visible price text.
  out = out.replace(/<lvl\s*[^>]*>([\s\S]*?)<\/lvl>/gi, "$1");

  // <risk level="low|medium|high">X</risk> — badge emoji by level.
  // High risk is wrapped in bold sentinels for extra visual weight in Telegram.
  out = out.replace(/<risk\s+level="low"\s*>([\s\S]*?)<\/risk>/gi, "🟢 $1");
  out = out.replace(/<risk\s+level="medium"\s*>([\s\S]*?)<\/risk>/gi, "🟡 $1");
  out = out.replace(
    /<risk\s+level="high"\s*>([\s\S]*?)<\/risk>/gi,
    `${SENTINEL_B_OPEN}🔴 $1${SENTINEL_B_CLOSE}`,
  );
  out = out.replace(/<risk\s*[^>]*>([\s\S]*?)<\/risk>/gi, "$1");

  // <verdict type="bullish|bearish|neutral">X</verdict> — directional emoji + italic.
  out = out.replace(
    /<verdict\s+type="bullish"\s*>([\s\S]*?)<\/verdict>/gi,
    `${SENTINEL_I_OPEN}🐂 $1${SENTINEL_I_CLOSE}`,
  );
  out = out.replace(
    /<verdict\s+type="bearish"\s*>([\s\S]*?)<\/verdict>/gi,
    `${SENTINEL_I_OPEN}🐻 $1${SENTINEL_I_CLOSE}`,
  );
  out = out.replace(
    /<verdict\s+type="neutral"\s*>([\s\S]*?)<\/verdict>/gi,
    `${SENTINEL_I_OPEN}〰️ $1${SENTINEL_I_CLOSE}`,
  );
  out = out.replace(
    /<verdict\s*[^>]*>([\s\S]*?)<\/verdict>/gi,
    `${SENTINEL_I_OPEN}$1${SENTINEL_I_CLOSE}`,
  );

  // Insert a blank line before a standalone <verdict> block (one that starts on
  // its own line). Restricted to italic-sentinel + verdict emoji prefix to avoid
  // inserting extra newlines before other italic content. Inline verdicts
  // mid-paragraph (no preceding newline) are intentionally left unchanged.
  out = out.replace(/(\n)(\x00I_OPEN\x00(?:🐂 |🐻 |〰️ )?)/g, "$1\n$2");

  // <chart symbol="X" interval="Y" ... /> — emit a footer hint instead of
  // dropping silently. The paired form <chart ...>...</chart> also emits the
  // same hint (rare LLM variant). Both must be handled BEFORE the generic
  // self-closing and paired-fallback passes below.
  const chartHint = (attrs: string): string => {
    const symMatch = /\bsymbol\s*=\s*"([^"]+)"/i.exec(attrs);
    const intMatch = /\binterval\s*=\s*"([^"]+)"/i.exec(attrs);
    if (!symMatch || !intMatch) return "";
    return `\n📊 ${symMatch[1]} ${intMatch[1]} chart`;
  };
  // Paired form first: <chart ...>...</chart> — must precede self-closing pass.
  out = out.replace(/<chart\s*([^>]*)>([\s\S]*?)<\/chart>/gi, (_m, attrs: string) =>
    chartHint(attrs),
  );
  // Self-closing form: <chart ... /> (requires closing slash).
  out = out.replace(/<chart\s+([^>]*?)\/>/gi, (_m, attrs: string) => chartHint(attrs));

  // Unknown self-closing tag → drop entirely.
  out = out.replace(/<[a-zA-Z][\w-]*\b[^/>]*\/>/g, "");

  // Generic paired fallback. We loop because the agent may nest unknown wrappers
  // around known ones (e.g. <side><price>X</price></side>). Each pass peels one
  // layer; capped to avoid pathological input.
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out.replace(/<([a-zA-Z][\w-]*)\b[^>]*>([\s\S]*?)<\/\1>/g, "$2");
    if (out === before) break;
  }

  // Strip any unclosed trailing tag that might be streaming mid-token — prevents
  // a partial `<pri` from poisoning the HTML-escape pass.
  out = out.replace(/<[a-zA-Z][^>]*$/g, "");

  return out;
}
