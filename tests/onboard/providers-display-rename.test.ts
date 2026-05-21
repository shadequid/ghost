/**
 * Guards that the removed claude-cli provider no longer appears in the
 * provider list after the earendil-works migration.
 */

import { describe, test, expect } from "bun:test";
import { getProviderList } from "../../src/onboard/providers.js";

describe("getProviderList — claude-cli removed", () => {
  test("claude-cli is not present in the provider list", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry).toBeUndefined();
  });

  test("list still contains core providers (openrouter, anthropic)", () => {
    const list = getProviderList();
    const ids = list.map((p) => p.id);
    expect(ids).toContain("openrouter");
    expect(ids).toContain("anthropic");
  });
});
