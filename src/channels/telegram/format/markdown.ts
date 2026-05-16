/**
 * Markdown-to-sentinel conversion for the Telegram formatter.
 *
 * Sentinels are NUL-delimited markers that survive HTML-escape and are then
 * materialised into real HTML tags (<b>, <i>, <code>, <pre>, <a>). Split out
 * of `telegram-format.ts` to keep files focused per CLAUDE.md size guidelines.
 */

export const SENTINEL_B_OPEN = "\x00B_OPEN\x00";
export const SENTINEL_B_CLOSE = "\x00B_CLOSE\x00";
export const SENTINEL_I_OPEN = "\x00I_OPEN\x00";
export const SENTINEL_I_CLOSE = "\x00I_CLOSE\x00";
export const SENTINEL_CODE_OPEN = "\x00C_OPEN\x00";
export const SENTINEL_CODE_CLOSE = "\x00C_CLOSE\x00";
// Link sentinels: SENTINEL_A_OPEN + URL + \x01 + text + SENTINEL_A_CLOSE.
export const SENTINEL_A_OPEN = "\x00A_OPEN:";
export const SENTINEL_A_SEP = "\x01";
export const SENTINEL_A_CLOSE = "\x00A_CLOSE\x00";

// `<pre>` placeholder: side-table reference. Format: \x00PRE_REF:N\x00.
// Inner content is stashed verbatim and spliced back AFTER materializeSentinels,
// so later passes (markdown / links / bullets) cannot rewrite anything inside
// a caller-supplied <pre> block. Telegram parses <pre> strictly and will reject
// the message if it finds <b>/<i>/<a> inside.
const PRE_REF_PREFIX = "\x00PRE_REF:";
const PRE_REF_SUFFIX = "\x00";

/** Insert a newline before any heading marker stuck to a non-newline char.
 *  The previous char must not itself be `#` so we don't slice an in-progress
 *  heading mid-marker (e.g. the inner `#` of `####`). */
export function normalizeHeadings(text: string): string {
  return text.replace(/([^\n#])(#{1,6}\s)/g, "$1\n$2");
}

/** Convert headings and inline markdown to HTML sentinels so they survive escaping. */
/** Extract `<pre>…</pre>` bodies into a side table and replace each block with
 *  a numeric placeholder (`\x00PRE_REF:N\x00`). The placeholder is opaque to
 *  every later pass — `stripCustomTags`, `convertMarkdown`, `convertLinks`,
 *  `convertBullets` walk past it untouched. After `materializeSentinels`, call
 *  {@link splicePreBodies} with the same side table to restore the inner text
 *  wrapped in real `<pre>` tags (after `htmlEscape` so `< > &` stay safe). */
export function convertPreBlocks(text: string): { text: string; bodies: string[] } {
  const bodies: string[] = [];
  const out = text.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_m, inner: string) => {
      const idx = bodies.length;
      bodies.push(inner);
      return `${PRE_REF_PREFIX}${idx}${PRE_REF_SUFFIX}`;
    },
  );
  return { text: out, bodies };
}

/** Splice `<pre>` bodies back into a fully-rendered string. Inner text passes
 *  through `htmlEscape` only — markdown / bullets / links inside the block
 *  remain literal, matching the docstring contract on {@link convertPreBlocks}. */
export function splicePreBodies(text: string, bodies: readonly string[]): string {
  if (bodies.length === 0) return text;
  return text.replace(
    /\x00PRE_REF:(\d+)\x00/g,
    (_m, n: string) => {
      const body = bodies[Number(n)];
      if (body === undefined) return "";
      return `<pre>${htmlEscape(body)}</pre>`;
    },
  );
}

export function convertMarkdown(text: string): string {
  const lines = text.split("\n").map((line) => {
    const m = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (m) return `${SENTINEL_B_OPEN}${m[1] ?? ""}${SENTINEL_B_CLOSE}`;
    return line;
  });
  let out = lines.join("\n");

  // Inline code `X` → <code>X</code>. Handled before bold/italic so `**x**` inside
  // backticks is preserved.
  out = out.replace(/`([^`\n]+)`/g, `${SENTINEL_CODE_OPEN}$1${SENTINEL_CODE_CLOSE}`);
  // Bold **X** → <b>X</b>
  out = out.replace(/\*\*([^*\n]+)\*\*/g, `${SENTINEL_B_OPEN}$1${SENTINEL_B_CLOSE}`);
  // Italic *X* → <i>X</i> (avoid matching ** residue by requiring non-asterisk boundary).
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, `$1${SENTINEL_I_OPEN}$2${SENTINEL_I_CLOSE}`);
  return out;
}

/** Build a sentinel-wrapped link directly. Lets callers embed `[…]` brackets
 *  inside the link label — markdown's `[label](url)` syntax can't (the
 *  parser stops at the first `]`), but the pipeline's sentinel form has no
 *  such restriction. Resolves to `<a href="url">label</a>` after
 *  `materializeSentinels`. The label is interpolated verbatim, so the
 *  caller is responsible for any escaping it needs (markdown emphasis
 *  stripping, etc.). */
export function wrapLink(url: string, label: string): string {
  return `${SENTINEL_A_OPEN}${url}${SENTINEL_A_SEP}${label}${SENTINEL_A_CLOSE}`;
}

/** Replace markdown links `[text](url)` with sentinel <a> markers.
 *  URL class matches "non-paren non-space" OR one balanced `(…)` group so
 *  references like `https://en.wikipedia.org/wiki/Foo_(disambiguation)` survive. */
export function convertLinks(text: string): string {
  const re = /\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;
  return text.replace(re,
    (_m, label: string, url: string) => `${SENTINEL_A_OPEN}${url}${SENTINEL_A_SEP}${label}${SENTINEL_A_CLOSE}`,
  );
}

/** Convert leading `- ` or `* ` bullets to `• `. Runs after markdown conversion
 *  so `**bold**` (already rewritten to sentinels) cannot be confused with `*`
 *  italic markers or list bullets. Skips lines inside fenced code blocks so
 *  CLI snippets / JSON with leading `-` flags survive verbatim. */
export function convertBullets(text: string): string {
  const lines = text.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^[ \t]*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^([ \t]*)[-*][ \t]+/, "$1• ");
    })
    .join("\n");
}

export function htmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function materializeSentinels(text: string): string {
  let out = text
    .replaceAll(SENTINEL_B_OPEN, "<b>")
    .replaceAll(SENTINEL_B_CLOSE, "</b>")
    .replaceAll(SENTINEL_I_OPEN, "<i>")
    .replaceAll(SENTINEL_I_CLOSE, "</i>")
    .replaceAll(SENTINEL_CODE_OPEN, "<code>")
    .replaceAll(SENTINEL_CODE_CLOSE, "</code>");

  // Link sentinels: SENTINEL_A_OPEN<url>\x01<label>SENTINEL_A_CLOSE.
  // At this point url + label have been HTML-escaped already; the URL still
  // needs attribute-context escape (extra `"` handling).
  const linkRe = new RegExp(
    `${SENTINEL_A_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${SENTINEL_A_SEP}([\\s\\S]*?)${SENTINEL_A_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "g",
  );
  out = out.replace(linkRe, (_m, url: string, label: string) => {
    // URL has already been &amp; etc-escaped; convert quote for attribute safety.
    const attrUrl = url.replace(/"/g, "&quot;");
    return `<a href="${attrUrl}">${label}</a>`;
  });
  return out;
}
