import type { Config, PaperConfig } from "../config/schema.js";

/**
 * Build the next Config for wizard "update provider/model only" mode.
 *
 * Pure — takes the currently-persisted config and the fields the update-mode
 * wizard collected, returns a new Config. Preserves every other top-level
 * field (channels, gateway.pairedTokens, security tweaks, etc.) so the save
 * does not silently reset them to defaults.
 *
 * `paper` is overlaid only when provided; caller passes it only when the
 * `--paper` CLI flag was present on this invocation.
 */
export interface UpdateModeOverlay {
  /** Resolved provider id — already set to `customProviderName` for custom endpoints. */
  provider: string;
  model: string;
  paper?: PaperConfig;
}

export function applyUpdateModeChanges(
  existing: Config,
  overlay: UpdateModeOverlay,
): Config {
  return {
    ...existing,
    provider: overlay.provider,
    model: overlay.model,
    ...(overlay.paper ? { paper: overlay.paper } : {}),
  };
}
