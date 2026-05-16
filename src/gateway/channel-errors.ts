/**
 * Typed error codes for channel setup failures.
 *
 * Returning a stable code (rather than English error copy) lets the UI map
 * each kind to localized text without brittle substring matching against
 * remote-API descriptions that can change at any time.
 */

/**
 * Base class for all channel setup errors. Carries a stable `code` string
 * so the WS layer can serialize via `toJSON()` and the web UI can map
 * each code to localized copy without brittle substring matching.
 */
export class ChannelSetupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChannelSetupError";
    this.code = code;
  }

  /** RPC payload shape — kept stable so the web UI can map `code` → copy. */
  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.message };
  }
}

export type TelegramSetupErrorCode =
  | "telegram_invalid_token"
  | "telegram_unauthorized"
  | "telegram_unreachable"
  | "telegram_already_registered"
  | "locality_required"
  | "telegram_unknown";

export class TelegramSetupError extends ChannelSetupError {
  declare readonly code: TelegramSetupErrorCode;

  constructor(code: TelegramSetupErrorCode, message: string) {
    super(code, message);
    this.name = "TelegramSetupError";
  }

  /** RPC payload shape — kept stable so the web UI can map `code` → copy. */
  toJSON(): { code: TelegramSetupErrorCode; message: string } {
    return { code: this.code as TelegramSetupErrorCode, message: this.message };
  }
}

