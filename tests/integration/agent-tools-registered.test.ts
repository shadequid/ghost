import { describe, test, expect } from "bun:test";
import pino from "pino";
import { createRuntime } from "../../src/runtime.js";
import { getConfigPath } from "../../src/config/index.js";

const silent = pino({ level: "silent" });

describe("runtime agent tool registration (regression)", () => {
  test("agent.state.tools includes trading tools after createRuntime", async () => {
    const runtime = await createRuntime({
      logger: silent,
      configPath: getConfigPath(),
    });

    const registryNames = new Set(runtime.tools.names());
    const agentToolNames = new Set(runtime.agent.state.tools.map((t) => t.name));

    // Trading tools must be in agent's callable set, not just the registry
    for (const expected of ["ghost_get_positions", "ghost_get_balance", "ghost_get_price"]) {
      expect(registryNames.has(expected)).toBe(true);
      expect(agentToolNames.has(expected)).toBe(true);
    }

    // Registry size must equal agent.state.tools size (snapshot must be fresh)
    expect(agentToolNames.size).toBe(registryNames.size);

    runtime.db.close();
  });
});
