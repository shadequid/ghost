/**
 * Classified error type from backend (`src/core/errors.ts`). Duplicated here
 * rather than imported because the web bundle doesn't cross the Bun/Vite
 * package boundary cleanly. The drift contract test in
 * `tests/web/error-type-drift.test.ts` reads the backend union and asserts
 * this one is a superset — keep both lists aligned.
 */
export type GhostErrorType =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'PROVIDER_DOWN'
  | 'TOOL_BLOCKED'
  | 'UNKNOWN';

const KNOWN_ERROR_TYPES: ReadonlyArray<GhostErrorType> = [
  'AUTH_FAILED',
  'RATE_LIMITED',
  'CONTEXT_OVERFLOW',
  'PROVIDER_DOWN',
  'TOOL_BLOCKED',
  'UNKNOWN',
];

/**
 * Type-guard for `GhostErrorType`. Use at the WS event edge to detect
 * backend-introduced codes (e.g. `BILLING_REQUIRED`) that the frontend
 * hasn't been updated for yet — callers should `console.warn` on false
 * so drift surfaces during development.
 */
export function isKnownErrorType(value: unknown): value is GhostErrorType {
  return typeof value === 'string' && (KNOWN_ERROR_TYPES as readonly string[]).includes(value);
}

/**
 * Friendly text for inline error bubbles, written in Ghost's voice
 * (first-person, warm, decisive — not sysadmin English). Callers invoke
 * this at the edge (e.g. `useChatEvents.ts` on `chat.error`) to populate
 * the `ChatMessage.content` field; the render layer (`MessageBubble`)
 * is dumb and just displays `content`.
 */
export function inlineErrorText(errorType: GhostErrorType | undefined): string {
  switch (errorType) {
    case 'RATE_LIMITED':
      return "I'm being rate-limited right now — give me a moment and try again";
    case 'PROVIDER_DOWN':
      return "I can't reach the model right now — looks like a connectivity hiccup";
    case 'TOOL_BLOCKED':
      return "I can't run that — security policy is blocking it";
    case 'AUTH_FAILED':
      return "Your API key isn't working — please check it and I'll try again";
    case 'CONTEXT_OVERFLOW':
      return "We've talked too much for me to keep track — let's start a new session";
    case 'UNKNOWN':
    default:
      return 'Something tripped me up — mind retrying?';
  }
}
