import { type ReactNode } from 'react';

/**
 * Inline parser for the trading-semantic tags Ghost emits in proactive
 * messages (`<price>`, `<lvl>`, `<pct>`, `<pnl>`, `<lev>`, `<side>`,
 * `<tag>`, `<risk>`, `<verdict>`, `<ind>`).
 *
 * The chat surface uses StreamingMarkdown for full markdown + tag support.
 * Lightweight surfaces (notification cards, toasts) don't want a markdown
 * engine but still need the tags rendered — otherwise the user sees raw
 * `<price>79,122 USDT</price>` text from the LLM.
 *
 * Inline only: no nesting, no block elements. Unknown tags fall through
 * as plain text so a future tag added on the agent side stays readable.
 * Malformed input (unterminated or mismatched tags) renders as the raw
 * source string — React escapes the angle brackets, so it's never an XSS
 * vector, only a visual fallback.
 *
 * `<lvl>` and `<ind>` are intentionally non-interactive on this surface:
 * chat uses `StreamingMarkdown` to wrap them in tooltip-bearing components,
 * but notification cards stay plain text.
 */

// Source for the tag matcher. Each call builds a fresh RegExp so the
// recursive call inside `renderTag` (parsing nested inner content) doesn't
// trample the outer scan's `lastIndex`.
const TAG_SOURCE = String.raw`<(\w+)(\s[^>]*)?>([\s\S]*?)</\1>`;

function parseAttrs(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function renderTag(
  name: string,
  attrs: Record<string, string>,
  inner: string,
  key: number,
): ReactNode {
  const children = renderTradingTags(inner);
  switch (name) {
    case 'pct':
      return <span key={key} className={attrs.dir === 'up' ? 'trade-pct-up' : 'trade-pct-down'}>{children}</span>;
    case 'price':
    case 'lvl':
      return <span key={key} className="trade-price">{children}</span>;
    case 'pnl':
      return <span key={key} className={attrs.dir === 'up' ? 'trade-pnl-up' : 'trade-pnl-down'}>{children}</span>;
    case 'lev':
      return <span key={key} className="trade-leverage">{children}</span>;
    case 'side':
      return <span key={key} className={attrs.dir === 'long' ? 'trade-long' : 'trade-short'}>{children}</span>;
    case 'tag':
      return <span key={key} className={`trade-tag trade-tag-${attrs.type ?? 'entry'}`}>{children}</span>;
    case 'risk':
      return <span key={key} className={`trade-risk trade-risk-${attrs.level ?? 'medium'}`}>{children}</span>;
    case 'verdict':
      return <span key={key} className={`trade-verdict trade-verdict-${attrs.type ?? 'neutral'}`}>{children}</span>;
    case 'ind':
      return <span key={key}>{children}</span>;
    default:
      return null;
  }
}

export function renderTradingTags(text: string): ReactNode[] {
  if (!text) return [];
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  const re = new RegExp(TAG_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [match, name, rawAttrs, inner] = m;
    const start = m.index;
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    const node = renderTag(name!, parseAttrs(rawAttrs), inner!, key++);
    if (node === null) {
      // Unknown tag — preserve original text so nothing gets silently dropped.
      parts.push(match);
    } else {
      parts.push(node);
    }
    cursor = start + match.length;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}
