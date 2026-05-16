import pino from "pino";
import pinoPretty from "pino-pretty";

export type Verbosity = 0 | 1 | 2;

/** No-op logger for optional logger parameters. */
export const NOOP_LOGGER: pino.Logger = pino({ level: "silent" });

/**
 * Truncate a string for safe inclusion in log fields. Defaults to 200 chars
 * so noisy model outputs don't flood aggregators. Appends the original length
 * in brackets when truncated so operators can tell how much was dropped.
 *
 * Not a PII scrubber — callers that embed user content in prompts should
 * still audit what the model is given.
 */
export function redactForLog(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…[${text.length} chars]`;
}

/**
 * Scrub Telegram bot tokens from a string.
 *
 * Tokens appear as `<numeric_id>:<35+_char_secret>` and often surface inside
 * grammY error messages as part of the API URL:
 *   https://api.telegram.org/bot<TOKEN>/getMe
 *
 * The regex matches both the bare token form and the `bot<TOKEN>` URL form.
 * Applied in the pino `err` serializer so ALL `{ err }` log payloads (message
 * + stack) are scrubbed without needing per-call-site redaction.
 */
export function redactBotToken(s: string): string {
  // Matches: bot123456789:ABCdef-ghijkLMNOP_qrstUVWX0123456  (URL form)
  //      or: 123456789:ABCdef-ghijkLMNOP_qrstUVWX0123456     (bare form)
  return s.replace(/\bbot(\d+:[A-Za-z0-9_-]{30,})/g, "bot<redacted>")
          .replace(/\b(\d+:[A-Za-z0-9_-]{30,})/g, "<redacted>");
}

/** Pino `err` serializer that scrubs bot tokens from message + stack. */
function serializeErr(err: unknown): unknown {
  // Let pino's built-in errSerializer run first by returning a plain object
  // with the same shape, but with message and stack redacted.
  if (err instanceof Error) {
    return {
      type: err.constructor?.name ?? "Error",
      message: redactBotToken(err.message),
      stack: err.stack ? redactBotToken(err.stack) : err.stack,
    };
  }
  if (typeof err === "string") return redactBotToken(err);
  return err;
}

const VALID_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

export function createRootLogger(verbosity: Verbosity = 0): pino.Logger {
  const envLevel = process.env.LOG_LEVEL;
  const level =
    verbosity >= 2
      ? "trace"
      : verbosity >= 1
        ? "debug"
        : (envLevel && VALID_LEVELS.has(envLevel) ? envLevel : "info");

  const opts: pino.LoggerOptions = {
    level,
    serializers: {
      // Override pino's default err serializer to scrub bot tokens before
      // the log record is flushed to any transport (journald, syslog, etc.).
      // Covers `{ err }` log sites in channels/ and gateway/.
      err: serializeErr,
      // Also cover `rmErr` field used in manager.activate rollback log.
      rmErr: serializeErr,
    },
  };

  // Pino writes to stdout only. The OS service supervisor owns the log file:
  //   launchd  → StandardOutPath redirects stdout to ghost.log
  //   schtasks → cmd.exe `>>"%GHOST_LOG%" 2>&1` redirects stdout to ghost.log
  //   systemd  → StandardOutput=append:<path> redirects stdout to ghost.log
  // Pretty rendering only when attached to a real terminal.
  if (process.stdout.isTTY) {
    return pino(opts, pinoPretty({ colorize: true }));
  }
  return pino(opts);
}

