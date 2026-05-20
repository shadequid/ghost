/**
 * TimezoneService — single source of truth for the user's IANA timezone.
 *
 * Backed by PreferenceStore so changes persist across restarts without
 * touching config.json. Fallback is "UTC" — predictable regardless of host.
 */

import type { PreferenceStore } from "./preferences.js";
import { detectUserTimezone } from "../scheduler/defaults.js";

export const USER_TIMEZONE_KEY = "user.timezone";

export type TzValidation =
  | { ok: true; tz: string }
  | { ok: false; error: string };

/**
 * Validate an IANA timezone identifier.
 *
 * Uses Intl.DateTimeFormat as the sole validator so the accepted set always
 * matches what the JS runtime actually supports — no hardcoded list needed.
 * Normalises the result via resolvedOptions() so "europe/berlin" round-trips
 * to "Europe/Berlin" (casing varies by runtime).
 */
export function validateTimezone(input: unknown): TzValidation {
  if (typeof input !== "string") {
    return { ok: false, error: "Timezone must be a string" };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Timezone cannot be empty" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, error: "Timezone contains invalid characters" };
  }
  if (trimmed.length > 64) {
    return { ok: false, error: "Timezone exceeds maximum length" };
  }
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { timeZone: trimmed })
      .resolvedOptions().timeZone;
    return { ok: true, tz: resolved };
  } catch {
    return { ok: false, error: "Unknown timezone" };
  }
}

/**
 * Detect the host machine's IANA timezone.
 *
 * Used during onboard to suggest a default — NOT a runtime fallback. The
 * runtime always reads from TimezoneService (which defaults to "UTC").
 */
export function detectHostTimezone(): string {
  return detectUserTimezone();
}

export interface TimezoneService {
  /** Current timezone — stored preference or "UTC" if unset. Never throws. */
  get(): string;
  /** Validate and persist a new timezone. Returns the validation result. */
  set(input: unknown): TzValidation;
}

export function createTimezoneService(prefs: PreferenceStore): TimezoneService {
  return {
    get(): string {
      return prefs.getTimezone() ?? "UTC";
    },
    set(input: unknown): TzValidation {
      const result = validateTimezone(input);
      if (!result.ok) return result;
      prefs.setTimezone(result.tz);
      return result;
    },
  };
}
