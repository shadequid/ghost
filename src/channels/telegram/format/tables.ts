/**
 * Markdown table rendering for the Telegram formatter.
 *
 * Small tables get aligned monospace <pre> blocks; large tables fall back to
 * flat `key: value` lines so they stay readable in narrow chats. Separated from
 * `telegram-format.ts` to keep each module focused.
 */

// `<pre>` placeholder format: \x00PRE_REF:N\x00 — must match the side-table
// shape used in format-markdown.ts so the formatter can splice all <pre>
// bodies (caller-supplied + table-rendered) back in one final pass.
const PRE_REF_PREFIX = "\x00PRE_REF:";
const PRE_REF_SUFFIX = "\x00";

/** Approximate monospace display width of a string.
 *
 *  `.length` counts UTF-16 code units and mis-sizes CJK + emoji cells, so column
 *  alignment drifts for any non-ASCII content. Iterate codepoints instead: CJK
 *  Unified + Hangul + Japanese kana + common emoji ranges count as width 2;
 *  everything else counts as width 1. Not a full Unicode EastAsianWidth impl,
 *  but covers the cases Ghost hits in portfolio snapshots and TA tables.
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (
      // Hangul Jamo
      (cp >= 0x1100 && cp <= 0x115f) ||
      // CJK punctuation
      (cp >= 0x2e80 && cp <= 0x303f) ||
      // Hiragana + Katakana
      (cp >= 0x3040 && cp <= 0x30ff) ||
      // CJK Unified (+ extensions in BMP range)
      (cp >= 0x3400 && cp <= 0x9fff) ||
      // Hangul Syllables
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      // CJK Compatibility Ideographs
      (cp >= 0xf900 && cp <= 0xfaff) ||
      // Halfwidth/Fullwidth forms (Fullwidth portion)
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      // Common wide emoji ranges
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f300 && cp <= 0x1fbff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Render markdown tables. Small tables get aligned <pre> blocks; large tables
 *  fall back to flat "key: value" lines so they remain readable in narrow chats.
 *  Incomplete tables (no separator row yet) are left as-is so streaming looks OK.
 *
 *  `<pre>` blocks are emitted as side-table placeholders (`\x00PRE_REF:N\x00`)
 *  so later passes (markdown / links / bullets) can't rewrite the inner monospace
 *  content. The caller is responsible for splicing the bodies back at the end of
 *  the pipeline via the same `bodies` array. */
export function renderTables(text: string, bodies: string[]): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (header !== undefined && sep !== undefined && isTableRow(header) && isSeparatorRow(sep)) {
      const headers = splitRow(header);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j] !== undefined && isTableRow(lines[j] as string)) {
        rows.push(splitRow(lines[j] as string));
        j++;
      }
      const hasHeaderLabels = headers.some((h) => h.trim().length > 0);
      const cols = headers.length;
      const fitsPre = cols <= 6 && rows.length <= 15;
      if (fitsPre) {
        out.push(renderPreTable(headers, rows, hasHeaderLabels, bodies));
      } else {
        for (const row of rows) {
          if (cols === 2 || !hasHeaderLabels) {
            out.push(`${row[0] ?? ""}: ${row.slice(1).join(" ")}`.trim());
          } else {
            const parts: string[] = [];
            for (let k = 0; k < Math.min(cols, row.length); k++) {
              const h = (headers[k] ?? "").trim();
              const v = (row[k] ?? "").trim();
              if (!v) continue;
              parts.push(h ? `${h}: ${v}` : v);
            }
            out.push(parts.join(" · "));
          }
        }
      }
      i = j;
      continue;
    }
    out.push(lines[i] as string);
    i++;
  }
  return out.join("\n");
}

/** Build an aligned monospace block. The body is stashed in the shared `bodies`
 *  side table and replaced with a `\x00PRE_REF:N\x00` placeholder so the later
 *  pipeline passes (markdown / links / bullets / html-escape) can't rewrite
 *  inside it. Sizes columns by `displayWidth` (not `.length`) and pads
 *  manually so CJK + emoji cells line up correctly. */
export function renderPreTable(headers: string[], rows: string[][], hasHeaderLabels: boolean, bodies: string[]): string {
  const cols = headers.length;
  const allRows = hasHeaderLabels ? [headers, ...rows] : rows;
  const widths: number[] = new Array(cols).fill(0);
  for (const row of allRows) {
    for (let k = 0; k < cols; k++) {
      const cell = (row[k] ?? "").trim();
      const w = displayWidth(cell);
      if (w > widths[k]!) widths[k] = w;
    }
  }
  const padCell = (cell: string, k: number): string => {
    const v = cell.trim();
    if (k === cols - 1) return v;
    const pad = Math.max(0, widths[k]! - displayWidth(v));
    return v + " ".repeat(pad);
  };
  const lines: string[] = [];
  if (hasHeaderLabels) {
    lines.push(headers.map(padCell).join("  "));
  }
  for (const row of rows) {
    const padded: string[] = [];
    for (let k = 0; k < cols; k++) padded.push(padCell(row[k] ?? "", k));
    lines.push(padded.join("  "));
  }
  const idx = bodies.length;
  bodies.push(lines.join("\n"));
  return `${PRE_REF_PREFIX}${idx}${PRE_REF_SUFFIX}`;
}

export function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length >= 3;
}

export function isSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = splitRow(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

export function splitRow(line: string): string[] {
  const t = line.trim();
  return t.slice(1, -1).split("|").map((c) => c.trim());
}
