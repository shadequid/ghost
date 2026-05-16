import { password as promptPassword, select, isCancel } from "@clack/prompts";
import { SecretStore } from "../../config/secrets.js";
import { CredentialStore } from "../../config/credentials.js";
import { getSecretKeyPath, getCredentialsPath } from "../../config/paths.js";
import { NOOP_LOGGER } from "../../logger.js";
import { CHANNEL_PLUGINS } from "../../channels/index.js";
import type { ChannelPlugin } from "../../channels/types.js";
import type { CommandIO } from "../shared.js";

export interface ChannelSetupDeps {
  /** Channel id from CLI arg. Undefined → interactive picker. */
  channel?: string;
  tokenArg?: string;
  io: CommandIO;
}

async function pickPlugin(io: CommandIO): Promise<ChannelPlugin> {
  const choice = await select({
    message: "Which channel do you want to set up?",
    options: CHANNEL_PLUGINS.map((p) => ({
      value: p.id,
      label: `${p.label} (${p.id})`,
      hint: p.description,
    })),
  });
  if (isCancel(choice) || typeof choice !== "string") {
    io.err("Cancelled.");
    io.exit(1);
  }
  // io.exit throws in tests and calls process.exit in production, so this is unreachable.
  const plugin = CHANNEL_PLUGINS.find((p) => p.id === choice)!;
  return plugin;
}

export async function runChannelSetup(deps: ChannelSetupDeps): Promise<void> {
  let plugin: ChannelPlugin;
  if (deps.channel) {
    const found = CHANNEL_PLUGINS.find((p) => p.id === deps.channel);
    if (!found) {
      deps.io.err(
        `Unknown channel: ${deps.channel}. Available: ${CHANNEL_PLUGINS.map((p) => p.id).join(", ")}`,
      );
      deps.io.exit(1);
    }
    // io.exit throws in tests and calls process.exit in production, so this is unreachable.
    plugin = found!;
  } else {
    plugin = await pickPlugin(deps.io);
  }

  let token = deps.tokenArg?.trim();
  if (!token) {
    const entered = await promptPassword({ message: `Enter ${plugin.label} bot token` });
    if (isCancel(entered) || typeof entered !== "string" || !entered.trim()) {
      deps.io.err("Cancelled.");
      deps.io.exit(1);
    }
    token = (entered as string).trim();
  }

  const secretStore = new SecretStore(getSecretKeyPath());
  const credentials = new CredentialStore(getCredentialsPath(), secretStore, NOOP_LOGGER);

  try {
    const result = await plugin.setup({ credentials, token });
    deps.io.log(`✓ ${result.summary}`);
    deps.io.log("Run `ghost daemon` to apply.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.io.err(`Setup failed: ${msg}`);
    deps.io.exit(1);
  }
}
