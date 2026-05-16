import { describe, test, expect, mock } from "bun:test";
import { createClaudeCliProvider } from "../../../src/providers/claude-cli/index.js";
import { CliHandoffStore } from "../../../src/providers/claude-cli/handoff-store.js";
import { NOOP_LOGGER } from "../../../src/logger.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import type { ConfirmService } from "../../../src/services/trading-confirm.js";
import type { EventBus } from "../../../src/bus/events.js";
import type { SecurityPolicy } from "../../../src/security/policy.js";
import type { LeakDetector } from "../../../src/security/leak-detector.js";

function makeDeps() {
  const handoffStore = new CliHandoffStore(
    join(tmpdir(), `ghost-test-${Date.now()}`, "cli-handoff.json"),
    NOOP_LOGGER,
  );
  const tools = {
    all: () => [],
    execute: mock(async () => ({ content: [] })),
  } as unknown as ToolRegistry;
  const confirmService = {} as ConfirmService;
  const eventBus = { publish: () => {} } as unknown as EventBus;
  const security = {
    enforceToolOperation: () => {},
    isPathAllowed: () => true,
  } as unknown as SecurityPolicy;
  const leakDetector = {
    scrub: (text: string) => ({ clean: true, patterns: [], redacted: text }),
  } as unknown as LeakDetector;

  return {
    model: "sonnet",
    permissionMode: "bypassPermissions" as PermissionMode,
    workspacePath: "/tmp/test-ws",
    builtinSkillsDir: undefined,
    userSkillsDir: undefined,
    buildCliSystemPrompt: () => "cli system prompt",
    handoffStore,
    tools,
    confirmService,
    eventBus,
    security,
    leakDetector,
  };
}

describe("createClaudeCliProvider", () => {
  test("exposes register and setupWorkspace", () => {
    const provider = createClaudeCliProvider(makeDeps());
    expect(typeof provider.register).toBe("function");
    expect(typeof provider.setupWorkspace).toBe("function");
  });

  test("clears the handoff store when the workspace lacks CLAUDE.md", () => {
    const deps = makeDeps();
    deps.handoffStore.save({ sessionId: "s1", systemPromptHash: "h1", syncedCount: 3 });
    createClaudeCliProvider(deps);
    expect(deps.handoffStore.load()).toBeNull();
  });
});
