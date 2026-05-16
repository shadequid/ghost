import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configSchema, type Config } from "./schema.js";
import { ConfigError } from "../core/errors.js";

/**
 * Pre-parse structural migration. Idempotent — re-running on an already-
 * migrated config is a no-op.
 *
 * v1 → v2: lift `channels.telegram` to root-level `telegram` field.
 *   Existing installs stored `{ channels: { telegram: { ... } } }`.
 *   New schema expects `{ telegram: { ... } }` at root.
 */
function migrateRawConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const channels = raw["channels"];
  if (channels && typeof channels === "object" && !Array.isArray(channels)) {
    const ch = channels as Record<string, unknown>;
    if (ch["telegram"] !== undefined && raw["telegram"] === undefined) {
      raw = { ...raw, telegram: ch["telegram"] };
      const { telegram: _dropped, ...rest } = ch;
      // Only delete the channels field if it had only telegram (or is now empty).
      const remaining = rest;
      raw = { ...raw, channels: Object.keys(remaining).length > 0 ? remaining : undefined };
    }
  }
  return raw;
}

/** Apply GHOST_* environment variable overrides to a raw config object. */
export function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };

  if (process.env["GHOST_PROVIDER"]) {
    result["provider"] = process.env["GHOST_PROVIDER"];
  }
  if (process.env["GHOST_MODEL"]) {
    result["model"] = process.env["GHOST_MODEL"];
  }
  if (process.env["GHOST_GATEWAY_PORT"] || process.env["GHOST_GATEWAY_HOST"]) {
    const gateway = (typeof result["gateway"] === "object" && result["gateway"] !== null
      ? { ...(result["gateway"] as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    if (process.env["GHOST_GATEWAY_PORT"]) {
      gateway["port"] = process.env["GHOST_GATEWAY_PORT"];
    }
    if (process.env["GHOST_GATEWAY_HOST"]) {
      gateway["host"] = process.env["GHOST_GATEWAY_HOST"];
    }
    result["gateway"] = gateway;
  }

  return result;
}

/**
 * Load, parse, and validate the Ghost config.
 * Throws ConfigError if config file does not exist — run `ghost onboard` first.
 */
export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    throw new ConfigError(
      `Config not found: ${configPath}\nRun "ghost onboard" to set up Ghost.`,
      "CONFIG_NOT_FOUND",
    );
  }

  const text = readFileSync(configPath, "utf-8");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConfigError(
      `Invalid JSON in config: ${configPath}\nFix the file or delete it and run "ghost onboard".`,
      "CONFIG_PARSE_ERROR",
    );
  }
  raw = applyEnvOverrides(raw);
  raw = migrateRawConfig(raw);

  return configSchema.parse(raw);
}

/** Save a typed Config object to disk with 0o600 permissions. */
export function saveConfig(config: Config, configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Save raw config data to disk with 0o600 permissions. Used by onboarding wizard. */
export function saveConfigRaw(data: Record<string, unknown>, configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, JSON.stringify(data, null, 2), { mode: 0o600 });
}
