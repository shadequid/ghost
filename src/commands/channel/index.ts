export { runChannelPair } from "./pair.js";
export { runChannelStatus } from "./status.js";

import { runChannelPair } from "./pair.js";
import { runChannelStatus } from "./status.js";
import { CHANNEL_IDS } from "../../channels/types.js";
import type { ChannelId as ChannelIdType } from "../../channels/types.js";
import type { CommandIO } from "../shared.js";

const STDIO: CommandIO = {
  log: (msg: string) => console.log(msg),
  err: (msg: string) => console.error(msg),
  exit: (code: number): never => process.exit(code),
};

/**
 * Resolve a channel id from a CLI arg.
 *
 * Returns the ChannelId when `arg` matches a registered channel id,
 * undefined otherwise (caller emits "Unknown channel" error).
 */
function resolveChannelId(arg: string): ChannelIdType | undefined {
  if ((CHANNEL_IDS as readonly string[]).includes(arg)) {
    return arg as ChannelIdType;
  }
  return undefined;
}

export async function runChannelCli(
  subcommand: string | undefined,
  _rest: string[],
  flags: { json?: boolean; token?: string },
): Promise<void> {
  const io = STDIO;

  switch (subcommand) {
    case "setup": {
      const channel = _rest[0];
      const { runChannelSetup } = await import("./setup.js");
      await runChannelSetup({ channel, tokenArg: flags.token, io });
      break;
    }
    case "pair": {
      const first = _rest[0];

      // ghost channel pair  — list pending across all channels (read-only, no security implication)
      if (first === undefined) {
        const { runChannelPairListAll } = await import("./pair.js");
        await runChannelPairListAll({ io, json: flags.json });
        break;
      }

      if (first === "approve") {
        io.err(
          `Usage: ghost channel pair <channel> approve [code]. Available: ${CHANNEL_IDS.join(", ")}`,
        );
        return io.exit(1);
      }

      const channel = resolveChannelId(first);
      if (!channel) {
        io.err(`Unknown channel: ${first}. Available: ${CHANNEL_IDS.join(", ")}`);
        return io.exit(1);
      }

      // ghost channel pair <channel> approve [code]
      if (_rest[1] === "approve") {
        const { runChannelPairApprove } = await import("./pair.js");
        await runChannelPairApprove({
          channel,
          codeArg: _rest[2],
          isTTY: process.stdin.isTTY === true,
          io,
        });
        break;
      }

      // ghost channel pair <channel>  — list pending for that channel
      await runChannelPair({ channel, json: flags.json, io });
      break;
    }
    case "status":
      await runChannelStatus({
        json: flags.json,
        io,
      });
      break;
    default:
      io.err("Usage: ghost channel setup|pair|status [--json]");
      io.exit(1);
  }
}
