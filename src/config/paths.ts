/**
 * Centralized path resolution for all Ghost directories and files.
 * Single source of truth — never use expandHome("~/.ghost") directly elsewhere.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Replace leading ~/ with the user's home directory. */
export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2));
  }
  return filepath;
}

/** Ghost root directory. Env: GHOST_HOME. Default: ~/.ghost */
export function getGhostDir(): string {
  const env = Bun.env["GHOST_HOME"];
  if (env) return expandHome(env);
  return join(homedir(), ".ghost");
}

/** Workspace directory for memory, sessions, skills. */
export function getWorkspaceDir(): string {
  return join(getGhostDir(), "workspace");
}

/** Path to config.json. Honors GHOST_CONFIG_DIR for backward compatibility. */
export function getConfigPath(): string {
  const configDir = Bun.env["GHOST_CONFIG_DIR"];
  if (configDir) return join(expandHome(configDir), "config.json");
  return join(getGhostDir(), "config.json");
}

/** Path to brain.db (SQLite). */
export function getDbPath(): string {
  return join(getWorkspaceDir(), "brain.db");
}

/** Path to the encryption secret key. */
export function getSecretKeyPath(): string {
  return join(getGhostDir(), ".secret_key");
}

/** Path to credentials store. */
export function getCredentialsPath(): string {
  return join(getGhostDir(), "credentials.json");
}

/**
 * Path to custom providers registry (`~/.ghost/models.json`).
 *
 * Optional: the file doesn't have to exist — a missing file yields an empty
 * registry at load time.
 */
export function getModelsConfigPath(): string {
  return join(getGhostDir(), "models.json");
}

/** Path to eval harness config (judge provider/model/apiKey). */
export function getEvalConfigPath(): string {
  return join(getGhostDir(), "eval.json");
}

/** Path to daemon PID file. Written on startup, deleted on clean shutdown. */
export function getDaemonPidPath(): string {
  return join(getGhostDir(), "daemon.pid");
}

