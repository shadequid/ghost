/**
 * Best-effort JSON extraction from LLM output.
 *
 * Local reasoning models (Qwen3, DeepSeek-R1, gpt-oss, Nous Hermes, …) often
 * wrap their answers in reasoning-block tags or markdown code fences even when
 * the prompt forbids them. These helpers strip the wrappers then greedy-match
 * the first JSON object / array span.
 *
 * Returns `undefined` on any failure so callers can map to their own fallback
 * (snippet substitution, silent decision, etc.) without try/catch noise.
 */

const REASONING_TAG_RE = /<(think|thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/giu;
const MARKDOWN_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gu;

/**
 * Pre-clean raw LLM output before scanning for JSON: strip reasoning-block
 * tags (Qwen/DeepSeek/o1-style local ports) and unwrap markdown fences.
 */
function cleanLlmOutput(raw: string): string {
  return raw.replace(REASONING_TAG_RE, "").replace(MARKDOWN_FENCE_RE, "$1");
}

/**
 * Try `JSON.parse(input)` directly. Returns the value or `undefined` on failure.
 */
function tryParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

/**
 * Two-pass JSON object parser. Wins on the direct path when the model obeyed
 * the prompt; falls back to clean-then-scan for wrapped output.
 *
 * Scan strategy: extract all balanced `{...}` spans from the cleaned text
 * (shortest-depth-first via bracket counting), then try JSON.parse on each in
 * order. This handles both the "prose {word} before the real envelope" case and
 * deeply nested objects — without the greedy-vs-non-greedy tension.
 */
export function parseLlmJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const cleaned = cleanLlmOutput(trimmed);

  // Collect all balanced brace spans and try each in order.
  for (const span of extractBalancedBraceSpans(cleaned)) {
    const parsed = tryParse(span);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

/**
 * Yield all balanced `{...}` substrings from `text`, in the order they start.
 * For each `{`, tracks bracket depth and emits the span when depth returns to 0.
 * Simple string walk — no regex, handles nesting correctly.
 */
function* extractBalancedBraceSpans(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          yield text.slice(start, i + 1);
          start = -1;
        }
      }
    }
  }
}

/**
 * Two-pass JSON array parser. Non-greedy array match — widening to greedy
 * breaks on the `["a"] prose ["b"]` shape that some local models emit.
 * Strip-then-scan handles all realistic outputs.
 */
export function parseLlmJsonArray(raw: string): unknown[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const direct = tryParse(trimmed);
  if (Array.isArray(direct)) return direct;

  const cleaned = cleanLlmOutput(trimmed);
  const match = cleaned.match(/\[[\s\S]*?\]/u);
  if (!match) return undefined;
  const parsed = tryParse(match[0]);
  return Array.isArray(parsed) ? parsed : undefined;
}
