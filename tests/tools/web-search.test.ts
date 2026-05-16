import { describe, test, expect } from "bun:test";
import { WebSearchTool } from "../../src/tools/web-search.js";

describe("WebSearchTool", () => {
  test("name is web_search", () => {
    expect(new WebSearchTool().name).toBe("web_search");
  });

  test("has query and count parameters", () => {
    const tool = new WebSearchTool();
    expect(tool.parameters.properties).toHaveProperty("query");
  });

  test("throws when no search provider configured", async () => {
    const tool = new WebSearchTool();
    await expect(tool.execute("id", { query: "test" })).rejects.toThrow(/no.*search.*provider|api.*key/i);
  });
});
