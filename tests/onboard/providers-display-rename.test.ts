/**
 * Verifies that the claude-cli provider entry has been rebranded from
 * "Claude CLI" to "Claude Code" in both label and description.
 *
 * This guards against accidental regression of the Step 4 display rename.
 */

import { describe, test, expect } from "bun:test";
import { getProviderList } from "../../src/onboard/providers.js";

describe("getProviderList — claude-cli display rename", () => {
  test("claude-cli entry exists in the provider list", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry).toBeDefined();
  });

  test('claude-cli label is "Claude Code" (not "Claude CLI")', () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry?.label).toBe("Claude Code");
  });

  test("claude-cli description contains the string 'Claude Code'", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry?.description).toContain("Claude Code");
  });

  test("claude-cli is tier 0 (recommended)", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry?.tier).toBe(0);
  });

  test("claude-cli does not require OAuth", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry?.supportsOAuth).toBe(false);
  });

  test("claude-cli has no apiKeyUrl (uses subscription, not API key)", () => {
    const list = getProviderList();
    const entry = list.find((p) => p.id === "claude-cli");
    expect(entry?.apiKeyUrl).toBeUndefined();
  });
});
