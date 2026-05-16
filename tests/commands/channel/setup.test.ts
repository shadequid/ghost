import { describe, test, expect, mock } from "bun:test";
import type { ChannelPlugin, SetupCtx, SetupResult } from "../../../src/channels/types.js";
import type { CommandIO } from "../../../src/commands/shared.js";

// ---------------------------------------------------------------------------
// Mock CHANNEL_PLUGINS at the module boundary BEFORE importing setup.ts.
// Tests that need to vary plugin behavior do so by reassigning `stubPlugin.setup`.
// ---------------------------------------------------------------------------

const setupCalls: SetupCtx[] = [];
const stubPlugin: ChannelPlugin = {
  id: "telegram" as ChannelPlugin["id"],
  label: "Telegram",
  description: "Chat with Ghost from your phone",
  setup: mock(async (ctx: SetupCtx): Promise<SetupResult> => {
    setupCalls.push(ctx);
    return { summary: "Telegram connected as @ghostbot. DM @ghostbot on Telegram — the bot will reply with a pairing code." };
  }),
  status: mock(async () => ({ enabled: true, healthy: true, summary: "ok", detail: {} })),
  remove: mock(async () => ({ summary: "removed" })),
  notifyApproval: mock(async () => {}),
  activate: mock(async () => { throw new Error("not used in CLI"); }),
};

mock.module("../../../src/channels/index.js", () => ({
  CHANNEL_PLUGINS: [stubPlugin],
}));

// Dynamic import AFTER mock.module registration.
const { runChannelSetup } = await import("../../../src/commands/channel/setup.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIO(): { io: CommandIO; logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  const io: CommandIO = {
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    exit: (code) => { throw new Error(`__EXIT__${code}`); },
  };
  return { io, logs, errs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runChannelSetup", () => {
  test("known channel + tokenArg → plugin.setup called with correct token, summary logged", async () => {
    setupCalls.length = 0;
    stubPlugin.setup = mock(async (ctx: SetupCtx): Promise<SetupResult> => {
      setupCalls.push(ctx);
      return { summary: "Telegram connected as @ghostbot. DM @ghostbot on Telegram — the bot will reply with a pairing code." };
    });
    const { io, logs } = makeIO();

    await runChannelSetup({ channel: "telegram", tokenArg: "ABC123", io });

    expect(setupCalls).toHaveLength(1);
    expect(setupCalls[0].token).toBe("ABC123");
    expect(logs[0]).toContain("Telegram connected as @ghostbot");
    expect(logs[1]).toBe("Run `ghost daemon` to apply.");
  });

  test("unknown channel → exits 1 with message listing available", async () => {
    const { io, errs } = makeIO();
    await expect(
      runChannelSetup({ channel: "discord", tokenArg: "tok", io }),
    ).rejects.toThrow("__EXIT__1");
    expect(errs[0]).toContain("Unknown channel: discord");
    expect(errs[0]).toContain("telegram");
  });

  test("plugin.setup throws → logs 'Setup failed: <msg>' and exits 1", async () => {
    stubPlugin.setup = mock(async () => {
      throw new Error("Token validation failed: unauthorized");
    });
    const { io, errs } = makeIO();

    await expect(
      runChannelSetup({ channel: "telegram", tokenArg: "BAD", io }),
    ).rejects.toThrow("__EXIT__1");
    expect(errs[0]).toBe("Setup failed: Token validation failed: unauthorized");
  });

  // Note: interactive picker (`select`) test omitted — exercising the production
  // path requires mocking @clack/prompts which couples tests to internals.
  // Known-channel tests above cover the post-resolve flow that follows the picker.
});
