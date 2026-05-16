import { SecretStore } from "../../config/secrets.js";
import { CredentialStore } from "../../config/credentials.js";
import { getSecretKeyPath, getCredentialsPath } from "../../config/paths.js";
import { CHANNEL_PLUGINS } from "../../channels/index.js";
import { NOOP_LOGGER } from "../../logger.js";
import type { CommandIO } from "../shared.js";

export interface ChannelStatusDeps {
  json?: boolean;
  io: CommandIO;
}

/**
 * Print active channels and their state.
 * Reads credentials directly — does not require daemon running.
 */
export async function runChannelStatus(deps: ChannelStatusDeps): Promise<void> {
  const secretStore = new SecretStore(getSecretKeyPath());
  const credentials = new CredentialStore(
    getCredentialsPath(),
    secretStore,
    NOOP_LOGGER,
  );

  const results = await Promise.all(
    CHANNEL_PLUGINS.map(async (p) => {
      const result = await p.status({ credentials, probe: false });
      return { id: p.id, label: p.label, ...result };
    }),
  );

  if (deps.json) {
    deps.io.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    const state = r.enabled ? (r.healthy ? "connected" : "error") : "not configured";
    deps.io.log(`${r.id.padEnd(12)} ${state}  ${r.summary}`);
  }
}
