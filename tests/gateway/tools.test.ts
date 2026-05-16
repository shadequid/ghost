import { describe, test, expect } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerToolsMethods } from "../../src/gateway/tools.js";

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

describe("tools methods", () => {
  test("tools.list returns tool info", async () => {
    const reg = new MethodRegistry();
    const mockTools = {
      all: () => [
        { name: "read_file", description: "Read a file", parameters: { type: "object" } },
        { name: "exec", description: "Run a command", parameters: { type: "object" } },
      ],
    };
    registerToolsMethods(reg.register.bind(reg), { tools: mockTools as never });
    const result = await reg.dispatch("tools.list", makeCtx(), {}) as { tools: unknown[] };
    expect(result.tools).toHaveLength(2);
    expect((result.tools[0] as { name: string }).name).toBe("read_file");
  });
});
