import { describe, test, expect } from "bun:test";
import {
  createClaudeCliModel,
  getClaudeCliModels,
} from "../../../src/providers/claude-cli/models.js";

describe("createClaudeCliModel", () => {
  test("creates model with known alias", () => {
    const model = createClaudeCliModel("sonnet");
    expect(model.id).toBe("sonnet");
    expect(model.api).toBe("claude-cli");
    expect(model.reasoning).toBe(true);
  });
  test("creates model with unknown ID", () => {
    const model = createClaudeCliModel("custom-model");
    expect(model.id).toBe("custom-model");
    expect(model.name).toContain("custom-model");
  });
});

describe("getClaudeCliModels", () => {
  test("returns non-empty list", () => {
    const models = getClaudeCliModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id === "claude-sonnet-4-6")).toBe(true);
  });
});

describe("getClaudeCliModels (picker list)", () => {
  test("does not expose generic shortcuts", () => {
    const ids = getClaudeCliModels().map((m) => m.id);
    expect(ids).not.toContain("sonnet");
    expect(ids).not.toContain("opus");
    expect(ids).not.toContain("haiku");
  });

  test("exposes Claude Opus 4.7 (new flagship)", () => {
    const ids = getClaudeCliModels().map((m) => m.id);
    expect(ids).toContain("claude-opus-4-7");
  });

  test("keeps specific 4.6 models as legacy options", () => {
    const ids = getClaudeCliModels().map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-haiku-4-5");
  });
});

describe("createClaudeCliModel (acceptance for legacy configs)", () => {
  test("still resolves 'sonnet' shortcut to a valid Model object", () => {
    // Shortcuts are removed from the picker but must still work for existing config.json values.
    const model = createClaudeCliModel("sonnet");
    expect(model.id).toBe("sonnet");
    expect(model.name).toMatch(/Claude Sonnet/i);
    expect(model.provider).toBe("claude-cli");
  });

  test("still resolves 'opus' shortcut", () => {
    const model = createClaudeCliModel("opus");
    expect(model.id).toBe("opus");
    expect(model.name).toMatch(/Claude Opus/i);
  });

  test("still resolves 'haiku' shortcut", () => {
    const model = createClaudeCliModel("haiku");
    expect(model.id).toBe("haiku");
    expect(model.name).toMatch(/Claude Haiku/i);
  });
});
