/**
 * Parses one pino-emitted JSON log line into a renderable shape.
 *
 * Pino default sink writes `{ "level": 30, "time": 1736000000000, "msg": "…",
 * "name"?: "…", ...extras }` — numeric levels (10..60), epoch-ms time. We
 * normalize the level int to a string and split extras out so `--json` mode
 * can spread them back into its payload.
 */

export const LEVEL_MAP = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
} as const;

export type PinoLevelName = (typeof LEVEL_MAP)[keyof typeof LEVEL_MAP];

export interface ParsedLine {
  time?: number;
  level?: PinoLevelName;
  /** pino's standard `name` field, or Ghost's `module` field — first non-empty wins. */
  name?: string;
  msg: string;
  raw: string;
  extras?: Record<string, unknown>;
}

const RESERVED_KEYS = new Set([
  "level",
  "time",
  "msg",
  "name",
  "module",
  "pid",
  "hostname",
  "v",
]);

export function parsePinoLine(raw: string): ParsedLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const o = parsed as Record<string, unknown>;
  const time = typeof o.time === "number" ? o.time : undefined;
  const levelNum = typeof o.level === "number" ? o.level : undefined;
  const level =
    levelNum !== undefined
      ? (LEVEL_MAP as Record<number, PinoLevelName | undefined>)[levelNum]
      : undefined;
  // Prefer pino's `name`; fall back to Ghost's `module` (used by createRootLogger
  // children) so component labels (gateway, jobs, observer, …) surface in pretty
  // output. Whichever is present, the other goes into extras via RESERVED_KEYS
  // dropping both.
  const nameStr = typeof o.name === "string" ? o.name : undefined;
  const moduleStr = typeof o.module === "string" ? o.module : undefined;
  const name = nameStr ?? moduleStr;
  const msg = typeof o.msg === "string" ? o.msg : "";

  const extrasEntries = Object.entries(o).filter(([k]) => !RESERVED_KEYS.has(k));
  const extras = extrasEntries.length > 0 ? Object.fromEntries(extrasEntries) : undefined;

  return { time, level, name, msg, raw, extras };
}
