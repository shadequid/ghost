import { select, isCancel } from "@clack/prompts";
import { initDatabase } from "../../core/database.js";
import { getDbPath, getCredentialsPath, getSecretKeyPath } from "../../config/paths.js";
import { PairingStore } from "../../pairing/store.js";
import { NOOP_LOGGER } from "../../logger.js";
import { SecretStore } from "../../config/secrets.js";
import { CredentialStore } from "../../config/credentials.js";
import { CHANNEL_IDS } from "../../channels/types.js";
import { CHANNEL_PLUGINS } from "../../channels/index.js";
import type { CommandIO } from "../shared.js";

export interface ChannelPairListAllDeps {
  io: CommandIO;
  json?: boolean;
}

function channelLabel(id: string): string {
  return CHANNEL_PLUGINS.find((p) => p.id === id)?.label ?? id;
}

/**
 * List pending pairing requests across all registered channels, grouped by
 * channel. Read-only: safe to call with no security implications.
 */
export async function runChannelPairListAll(deps: ChannelPairListAllDeps): Promise<void> {
  const db = initDatabase(getDbPath());
  const store = new PairingStore(db, NOOP_LOGGER);
  try {
    const groups = CHANNEL_IDS.map((id) => ({
      channel: id,
      requests: store.listRequests(id).map((r) => ({
        code: r.code,
        senderId: r.senderId,
        username: r.username,
        createdAt: r.createdAt,
      })),
    })).filter((g) => g.requests.length > 0);

    if (deps.json) {
      deps.io.log(JSON.stringify({ pending: groups }, null, 2));
      return;
    }

    if (groups.length === 0) {
      deps.io.log("No pending pairing requests on any channel.");
      deps.io.log("Ask users to DM the bot — they will receive a pairing code.");
      return;
    }

    for (const g of groups) {
      deps.io.log(`Pending pairing requests for ${channelLabel(g.channel)} (${g.channel}):`);
      for (const r of g.requests) {
        const label = r.username ? `@${r.username}` : `id:${r.senderId}`;
        deps.io.log(`  code ${r.code}  ${label}`);
      }
      deps.io.log("");
    }
    deps.io.log("Approve via 'ghost channel pair <channel> approve <code>' or in the web dashboard.");
  } finally {
    db.close();
  }
}

export interface ChannelPairDeps {
  channel: string;
  json?: boolean;
  io: CommandIO;
}

/**
 * Generate a pairing code for a channel so the owner can approve an inbound
 * pairing request from the bot (e.g. after a user DMs the Telegram bot).
 *
 * This replaces the old `ghost pairing list` + manual approval flow with a
 * single command that surfaces pending requests.
 */
export async function runChannelPair(deps: ChannelPairDeps): Promise<void> {
  const db = initDatabase(getDbPath());
  let requests: Array<{ code: string; senderId: string; username: string | null; createdAt: number }>;
  try {
    const store = new PairingStore(db, NOOP_LOGGER);
    requests = store.listRequests(deps.channel).map((r) => ({
      code: r.code,
      senderId: r.senderId,
      username: r.username,
      createdAt: r.createdAt,
    }));
  } finally {
    db.close();
  }

  if (deps.json) {
    deps.io.log(JSON.stringify({ channel: deps.channel, pending: requests }, null, 2));
    return;
  }

  if (requests.length === 0) {
    deps.io.log(`No pending pairing requests for ${deps.channel}.`);
    deps.io.log(`Ask users to DM the bot — they will receive a pairing code.`);
    return;
  }

  deps.io.log(`Pending pairing requests for ${deps.channel}:`);
  for (const r of requests) {
    const label = r.username ? `@${r.username}` : `id:${r.senderId}`;
    deps.io.log(`  code ${r.code}  ${label}`);
  }
  deps.io.log(`\nApprove via 'ghost channel pair ${deps.channel} approve <code>' or in the web dashboard.`);
}

export interface ChannelPairApproveDeps {
  channel: string;
  codeArg?: string;
  isTTY: boolean;
  io: CommandIO;
}

export async function runChannelPairApprove(deps: ChannelPairApproveDeps): Promise<void> {
  const db = initDatabase(getDbPath());
  try {
    const store = new PairingStore(db, NOOP_LOGGER);
    let code = deps.codeArg?.trim();

    if (!code) {
      if (!deps.isTTY) {
        deps.io.err("Approve requires a code in non-interactive mode. Run 'ghost channel pair' first.");
        deps.io.exit(1);
      }
      const pending = store.listRequests(deps.channel);
      if (pending.length === 0) {
        deps.io.log(`No pending pairing requests for ${deps.channel}.`);
        return;
      }
      const choice = await select({
        message: `Approve pairing for ${deps.channel}`,
        options: pending.map((r) => ({
          value: r.code,
          label: r.username ? `@${r.username} — code ${r.code}` : `id:${r.senderId} — code ${r.code}`,
        })),
      });
      if (isCancel(choice) || typeof choice !== "string") {
        deps.io.err("Cancelled.");
        deps.io.exit(1);
      }
      code = choice as string;
    }

    const result = store.approveRequest(deps.channel, code);
    if (!result) {
      deps.io.err(`No pending request with code ${code}.`);
      deps.io.exit(1);
    }
    // io.exit throws in tests / calls process.exit in production — unreachable.
    const approved = result!;
    const label = approved.entry.username ? `@${approved.entry.username}` : `id:${approved.id}`;
    deps.io.log(`✓ Approved ${deps.channel} pairing for ${label} (code ${code}).`);

    const plugin = CHANNEL_PLUGINS.find((p) => p.id === deps.channel);
    if (!plugin) {
      deps.io.log(`(Notification skipped — no plugin registered for ${deps.channel}.)`);
      return;
    }
    try {
      const secretStore = new SecretStore(getSecretKeyPath());
      const credentials = new CredentialStore(getCredentialsPath(), secretStore, NOOP_LOGGER);
      await plugin.notifyApproval({ id: approved.id, credentials });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.io.err(`(Approval saved, but notification failed: ${msg})`);
    }
  } finally {
    db.close();
  }
}
