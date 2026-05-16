/**
 * Telegram-friendly formatter — public API.
 *
 * Why: web UI renders custom inline tags (<price>, <pnl dir>, <side dir>, <lev>,
 * <pct>, <tag type>) and GitHub-flavored markdown tables natively; Telegram does
 * not — users see raw XML and pipe characters. We convert to plain text + HTML
 * bold/italic so grammY can send with parse_mode: "HTML".
 *
 * Approach: line-by-line + small regexes. We deliberately avoid a real markdown
 * parser; inputs are LLM outputs, not arbitrary CommonMark. Order matters —
 * HTML-escape the whole input first (so stray `<script>` from user-echoed text
 * cannot crash Telegram's parser), then re-materialize our own <b>/<i>/<code>
 * wrappers using sentinels that survive escaping.
 *
 * Pipeline:
 *   normalize headings → strip custom tags → render tables → convert markdown
 *   → convert links → convert bullets → html-escape → materialize sentinels
 *
 * Internals are split across sibling modules to keep each file focused:
 *   - format/tags.ts      custom tag stripping
 *   - format/tables.ts    markdown table rendering + width helpers
 *   - format/markdown.ts  sentinel constants + markdown conversion
 *
 * Class shape: `TelegramFormatter` implements `ChannelFormatter` for the
 * generic `format(raw)` method; `splitIntoSegments` is a Telegram-specific
 * extra on the same class. Stateless today; constructor reserved for future
 * per-channel config (parse_mode toggle, link-preview defaults, custom emoji set).
 */

import type { ChannelFormatter } from "../../types.js";
import {
  normalizeHeadings,
  convertMarkdown,
  convertPreBlocks,
  splicePreBodies,
  convertLinks,
  convertBullets,
  htmlEscape,
  materializeSentinels,
} from "./markdown.js";
import { stripCustomTags, extractCharts } from "./tags.js";
import { renderTables } from "./tables.js";
import type { ChartSpec } from "../chart-renderer.js";

export type { ChartSpec } from "../chart-renderer.js";

export interface Segment {
  /** Segment content (raw markdown), passed to `format()` before sending. */
  content: string;
}

/** Threshold for paragraph-break splits — short replies stay as one segment. */
const PARAGRAPH_SPLIT_MIN_CHARS = 400;

export class TelegramFormatter implements ChannelFormatter {
  /** Render raw LLM markdown to Telegram HTML. */
  format(raw: string): string {
    if (!raw) return "";
    let out = normalizeHeadings(raw);
    // Extract caller-supplied <pre> bodies into a side table BEFORE any other
    // pass touches them. Markdown / links / bullets walk the whole buffer and
    // would otherwise rewrite inner text (Telegram rejects <pre><b>…</b></pre>).
    // The placeholder \x00PRE_REF:N\x00 is opaque to every later pass; bodies
    // are spliced back at the end with htmlEscape only.
    const { text: preExtracted, bodies } = convertPreBlocks(out);
    out = preExtracted;
    out = stripCustomTags(out);
    // renderTables also emits <pre> blocks; have it push into the same side
    // table so both caller-supplied and table-rendered bodies survive verbatim.
    out = renderTables(out, bodies);
    out = convertMarkdown(out);
    out = convertLinks(out);
    out = convertBullets(out);
    out = htmlEscape(out);
    out = materializeSentinels(out);
    out = splicePreBodies(out, bodies);
    // Collapse any 3+ consecutive blank lines down to a single paragraph break.
    out = out.replace(/\n{3,}/g, "\n\n");
    return out;
  }

  /**
   * Variant for the Telegram dispatcher: extracts `<chart>` specs BEFORE the
   * format pipeline runs, so the dispatcher can send screenshots alongside
   * prose. Legacy callers that use `format()` directly still get the text hint
   * from `stripCustomTags` (which finds no tags in the stripped input).
   */
  formatWithCharts(raw: string): { text: string; charts: ChartSpec[] } {
    if (!raw) return { text: "", charts: [] };
    const { text: stripped, charts } = extractCharts(raw);
    return { text: this.format(stripped), charts };
  }

  /**
   * Telegram-specific: split a long response into ordered segments suitable
   * for sending as separate messages. Splits on:
   *   1. `####`+ headings (4+ `#`) on their own line — start a new text segment
   *      (the heading line stays at the top of the new segment)
   *   2. `---` horizontal rules — drop the rule, start a new segment
   *   3. Blank-line paragraph breaks — only when the current segment exceeds
   *      ~400 chars, so short chatty replies don't fragment.
   *
   * Each segment is trimmed; empty segments are dropped.
   */
  splitIntoSegments(text: string): Segment[] {
    if (!text) return [];

    const segments: Segment[] = [];
    let cursor = "";
    const flush = (): void => {
      const trimmed = cursor.trim();
      if (trimmed.length > 0) segments.push({ content: trimmed });
      cursor = "";
    };

    const lines = text.split("\n");
    for (const raw of lines) {
      const trimmed = raw.trim();

      if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
        flush();
        continue;
      }

      if (/^#{4,6}\s+\S/.test(trimmed)) {
        flush();
        cursor = raw + "\n";
        continue;
      }

      if (trimmed.length === 0) {
        if (cursor.length >= PARAGRAPH_SPLIT_MIN_CHARS) {
          flush();
          continue;
        }
        cursor += "\n";
        continue;
      }

      cursor += raw + "\n";
    }
    flush();

    return segments;
  }

}
