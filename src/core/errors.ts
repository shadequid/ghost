/** Base error class for all Ghost runtime errors. */
export class GhostError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GhostError";
    this.code = code;
    // Restore correct prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when configuration is invalid or missing. */
export class ConfigError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ConfigError";
  }
}

/** Thrown when a security policy is violated. */
export class SecurityError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "SecurityError";
  }
}

/** Thrown when a memory operation fails. */
export class MemoryError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "MemoryError";
  }
}

/** Thrown when a tool execution fails. */
export class ToolError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ToolError";
  }
}

/** Thrown when an LLM provider call fails. */
export class ProviderError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ProviderError";
  }
}

/** Thrown when a channel send/receive operation fails. */
export class ChannelError extends GhostError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "ChannelError";
  }
}

// ---------------------------------------------------------------------------
// Error classification — maps raw errors to user-facing messages
// ---------------------------------------------------------------------------

export type GhostErrorType =
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "CONTEXT_OVERFLOW"
  | "PROVIDER_DOWN"
  | "TOOL_BLOCKED"
  | "UNKNOWN";

export interface ClassifiedError {
  type: GhostErrorType;
  userMessage: string;
}

/**
 * Classify an unknown error into a typed bucket with a user-safe message.
 * No sensitive data (keys, stack traces) is included in userMessage.
 */
export function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);

  if (/auth|unauthorized|401|forbidden|403/i.test(msg))
    return { type: "AUTH_FAILED", userMessage: "Authentication failed. Please check your API key or run `ghost doctor`." };

  if (/rate.?limit|429|too many/i.test(msg))
    return { type: "RATE_LIMITED", userMessage: "Rate limit reached. Please wait a moment and try again." };

  if (/context.*length|token.*limit|too long/i.test(msg))
    return { type: "CONTEXT_OVERFLOW", userMessage: "Context too long. Try starting a new conversation with `/reset`." };

  if (/ECONNREFUSED|ETIMEDOUT|network|fetch failed|503|502/i.test(msg))
    return { type: "PROVIDER_DOWN", userMessage: "Could not reach the LLM provider. Check your connection or try again." };

  if (/blocked|not allowed|security/i.test(msg))
    return { type: "TOOL_BLOCKED", userMessage: "Operation was blocked by security policy." };

  return { type: "UNKNOWN", userMessage: "Something went wrong. Please try again." };
}
