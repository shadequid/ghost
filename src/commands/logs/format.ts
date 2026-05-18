/**
 * Three line renderers for `ghost logs`:
 *   - pretty: TTY default with ANSI colorization
 *   - plain:  pipe-safe text, no ANSI
 *   - json:   one JSON record per line for machine consumption
 *
 * Hand-rolled ANSI codes — six total — avoid pulling chalk/picocolors. The
 * formatter takes `{rich}` rather than checking `isTTY` itself so callers can
 * honor `--no-color` and `--plain` without re-deriving them here.
 */

import type { ParsedLine } from "./parse.js";

const COLOR_CODES = {
  muted: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  accent: "\x1b[35m",
  reset: "\x1b[0m",
} as const;

type ColorKey = keyof typeof COLOR_CODES;

function colorize(rich: boolean, code: ColorKey, text: string): string {
  if (!rich || text.length === 0) return text;
  return `${COLOR_CODES[code]}${text}${COLOR_CODES.reset}`;
}

function levelColor(level?: string): ColorKey {
  if (level === "error" || level === "fatal") return "error";
  if (level === "warn") return "warn";
  if (level === "debug" || level === "trace") return "muted";
  return "info";
}

function formatShortTime(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  // HH:MM:SS.mmm — UTC. Local-time formatting is deferred (post-v1).
  return new Date(ms).toISOString().slice(11, 23);
}

function formatIsoTime(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

/**
 * Render the parsed extras as ` key=value key=value` (leading space, no
 * surrounding braces — keeps single-line output flat). Returns empty string
 * when there are no extras. Object/array values are JSON-encoded; strings
 * with whitespace get wrapped in double quotes so the pair stays parseable
 * by eye.
 */
function formatExtras(extras: Record<string, unknown> | undefined): string {
  if (!extras) return "";
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(extras)) {
    if (v === undefined) continue;
    pairs.push(`${k}=${formatExtraValue(v)}`);
  }
  return pairs.length === 0 ? "" : ` ${pairs.join(" ")}`;
}

function formatExtraValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") {
    // Quote strings that contain whitespace so `key=foo bar` reads as one pair.
    return /\s/.test(v) ? JSON.stringify(v) : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Objects/arrays: JSON. Truncate at 200 chars so a giant payload (errors with
  // stack, observer dumps) doesn't ruin terminal output. JSON.stringify throws
  // on circular refs and BigInts — swallow so a single bad extra doesn't crash
  // the whole follow loop.
  let json: string;
  try {
    json = JSON.stringify(v);
  } catch {
    return "<unserializable>";
  }
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

export function formatPretty(parsed: ParsedLine, opts: { rich: boolean }): string {
  const { rich } = opts;
  const time = colorize(rich, "muted", formatShortTime(parsed.time));
  const level = parsed.level ?? "";
  const levelLabel = level.padEnd(5);
  const lc = levelColor(level);
  const levelStr = colorize(rich, lc, levelLabel.trim() === "" ? "" : levelLabel);
  const name = parsed.name ? colorize(rich, "accent", `[${parsed.name}]`) : "";
  const body = parsed.msg || parsed.raw;
  const msg = colorize(rich, lc, body);
  const extras = colorize(rich, "muted", formatExtras(parsed.extras));
  return `${[time, levelStr, name, msg].filter((s) => s.length > 0).join(" ").trim()}${extras}`;
}

export function formatPlain(parsed: ParsedLine): string {
  const head = [
    formatIsoTime(parsed.time),
    parsed.level ?? "",
    parsed.name ? `[${parsed.name}]` : "",
    parsed.msg || parsed.raw,
  ]
    .filter((s) => s.length > 0)
    .join(" ")
    .trim();
  return `${head}${formatExtras(parsed.extras)}`;
}

export function formatJsonLine(parsed: ParsedLine): string {
  return JSON.stringify({
    type: "log",
    time: parsed.time,
    level: parsed.level,
    name: parsed.name,
    msg: parsed.msg,
    ...(parsed.extras ?? {}),
  });
}

export function formatRawLine(line: string): string {
  return line;
}
