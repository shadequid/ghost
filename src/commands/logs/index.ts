/**
 * `ghost logs` entry point. Reads `~/.ghost/logs/ghost.log` directly and
 * renders pino JSON lines in three modes:
 *   - tail-and-exit: bare `ghost logs` prints last N and exits
 *   - follow:        `ghost logs -f` polls with cursor every POLL_INTERVAL_MS
 *
 * EPIPE on stdout (e.g. `ghost logs --json | head -1`) exits cleanly.
 */

import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_MAX_BYTES, defaultLogPath, readLogTail } from "./tail.js";
import { parsePinoLine } from "./parse.js";
import { formatPlain, formatPretty, formatRawLine } from "./format.js";

export interface LogsOptions {
  follow: boolean;
  lines?: string;
  json: boolean;
  plain: boolean;
  noColor: boolean;
}

const POLL_INTERVAL_MS = 1_000;

function parsePositiveInt(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface Writers {
  logLine(text: string): void;
  errorLine(text: string): void;
  emitJson(payload: Record<string, unknown>, toStderr?: boolean): void;
}

function createWriters(): Writers {
  const write = (stream: NodeJS.WriteStream, text: string): void => {
    try {
      stream.write(text);
    } catch (err) {
      // EPIPE = downstream closed (e.g. `| head -1`). Exit clean.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPIPE") process.exit(0);
      throw err;
    }
  };
  return {
    logLine: (text) => write(process.stdout, `${text}\n`),
    errorLine: (text) => write(process.stderr, `${text}\n`),
    emitJson: (payload, toStderr = false) =>
      write(toStderr ? process.stderr : process.stdout, `${JSON.stringify(payload)}\n`),
  };
}

function emitLine(
  writers: Writers,
  jsonMode: boolean,
  pretty: boolean,
  rich: boolean,
  raw: string,
): void {
  const parsed = parsePinoLine(raw);
  if (jsonMode) {
    if (parsed) {
      writers.emitJson({
        type: "log",
        time: parsed.time,
        level: parsed.level,
        name: parsed.name,
        msg: parsed.msg,
        ...(parsed.extras ?? {}),
      });
    } else {
      writers.emitJson({ type: "raw", raw });
    }
    return;
  }
  if (parsed) {
    writers.logLine(pretty ? formatPretty(parsed, { rich }) : formatPlain(parsed));
  } else {
    writers.logLine(formatRawLine(raw));
  }
}

function emitNotice(writers: Writers, jsonMode: boolean, message: string): void {
  if (jsonMode) writers.emitJson({ type: "notice", message }, true);
  else writers.errorLine(message);
}

export async function runLogs(opts: LogsOptions): Promise<void> {
  const jsonMode = opts.json;
  const pretty = !jsonMode && Boolean(process.stdout.isTTY) && !opts.plain;
  const rich = pretty && !opts.noColor;
  const lineCount = parsePositiveInt(opts.lines, 200);
  const writers = createWriters();

  let cursor: number | undefined;
  let first = true;

  process.once("SIGINT", () => process.exit(0));

  while (true) {
    const payload = await readLogTail({
      file: defaultLogPath(),
      cursor,
      limit: lineCount,
      maxBytes: DEFAULT_MAX_BYTES,
    });

    if (first && jsonMode) {
      writers.emitJson({
        type: "meta",
        file: payload.file,
        cursor: payload.cursor,
        size: payload.size,
      });
    }

    for (const line of payload.lines) emitLine(writers, jsonMode, pretty, rich, line);

    if (payload.truncated) emitNotice(writers, jsonMode, "Log tail truncated.");
    if (payload.reset) emitNotice(writers, jsonMode, "Log cursor reset (file rotated).");

    cursor = payload.cursor;
    first = false;

    if (!opts.follow) return;
    await delay(POLL_INTERVAL_MS);
  }
}
