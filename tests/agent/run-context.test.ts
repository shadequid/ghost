import { describe, test, expect } from "bun:test";
import { agentRunContext } from "../../src/agent/run-context.js";

describe("agentRunContext", () => {
  test("getStore returns undefined outside any run()", () => {
    expect(agentRunContext.getStore()).toBeUndefined();
  });

  test("getStore returns the kind inside run()", () => {
    agentRunContext.run({ kind: "task" }, () => {
      expect(agentRunContext.getStore()?.kind).toBe("task");
    });
  });

  test("store propagates across await boundaries", async () => {
    await agentRunContext.run({ kind: "task" }, async () => {
      expect(agentRunContext.getStore()?.kind).toBe("task");
      await Promise.resolve();
      expect(agentRunContext.getStore()?.kind).toBe("task");
      await new Promise((r) => setTimeout(r, 1));
      expect(agentRunContext.getStore()?.kind).toBe("task");
    });
  });

  test("nested run() scopes do not leak siblings into each other", async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      agentRunContext.run({ kind: "task" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(agentRunContext.getStore()?.kind);
      }),
      // Sibling chain outside run() must see undefined.
      (async () => {
        await new Promise((r) => setTimeout(r, 2));
        seen.push(agentRunContext.getStore()?.kind);
      })(),
    ]);
    expect(seen).toContain("task");
    expect(seen).toContain(undefined);
  });
});
