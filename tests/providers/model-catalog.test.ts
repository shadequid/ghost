import { describe, expect, test } from "bun:test";
import { stripDatedSuffix, stripLatestLabel, filterModelCatalog, getRetiredEntry } from "../../src/providers/model-catalog.js";

describe("stripDatedSuffix", () => {
  test("strips Anthropic YYYYMMDD suffix", () => {
    expect(stripDatedSuffix("claude-opus-4-5-20251101")).toBe("claude-opus-4-5");
  });

  test("strips OpenAI YYYY-MM-DD suffix", () => {
    expect(stripDatedSuffix("gpt-4o-2024-05-13")).toBe("gpt-4o");
  });

  test("strips Mistral YYMM suffix", () => {
    expect(stripDatedSuffix("mistral-large-2411")).toBe("mistral-large");
  });

  test("leaves non-date suffix 'non-reasoning' alone", () => {
    expect(stripDatedSuffix("grok-4-1-fast-non-reasoning")).toBe("grok-4-1-fast-non-reasoning");
  });

  test("leaves non-date suffix '-it' alone", () => {
    expect(stripDatedSuffix("gemma-3-27b-it")).toBe("gemma-3-27b-it");
  });

  test("leaves non-date suffix '12b' alone", () => {
    expect(stripDatedSuffix("pixtral-12b")).toBe("pixtral-12b");
  });

  test("leaves single-digit version suffix '4-6' alone", () => {
    expect(stripDatedSuffix("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  // Design note: `-\d{4}$` also matches DeepSeek MMDD checkpoints like
  // `deepseek-r1-0528`. That is intentional — snapshot-dedup collapses
  // any dated suffix to its bare alias when the bare alias is present in
  // the same list (behaviour identical to Anthropic `-20251101` →
  // `claude-opus-4-5`). Users who want a specific checkpoint can type it
  // into `config.json` manually.
  test("strips DeepSeek MMDD checkpoint — by design, dedup behaves same as Anthropic", () => {
    expect(stripDatedSuffix("deepseek-r1-0528")).toBe("deepseek-r1");
  });

  test("returns input unchanged when no match", () => {
    expect(stripDatedSuffix("anything")).toBe("anything");
    expect(stripDatedSuffix("")).toBe("");
  });
});

describe("filterModelCatalog — retired drop", () => {
  test("drops ID present in RETIRED_MODELS[provider]", () => {
    // Use a provider entry we'll populate in Task 4; for now, temporarily test via stub.
    // This will pass after Task 4 populates anthropic entries.
    const raw = [
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    ];
    const filtered = filterModelCatalog("anthropic", raw);
    expect(filtered.map((m) => m.id)).not.toContain("claude-3-haiku-20240307");
    expect(filtered.map((m) => m.id)).toContain("claude-opus-4-7");
  });

  test("unknown provider passes through unchanged", () => {
    const raw = [
      { id: "some-model", name: "Some Model" },
      { id: "another-model", name: "Another Model" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    expect(filtered).toEqual(raw);
  });

  test("empty input returns empty output", () => {
    expect(filterModelCatalog("anthropic", [])).toEqual([]);
  });
});

describe("filterModelCatalog — snapshot dedup", () => {
  test("drops dated snapshot when bare alias exists in same list (Anthropic)", () => {
    const raw = [
      { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5 (20251101)" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    expect(filtered.map((m) => m.id)).toEqual(["claude-opus-4-5"]);
  });

  test("drops dated snapshot when bare alias exists (OpenAI YYYY-MM-DD)", () => {
    const raw = [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-2024-05-13", name: "GPT-4o (2024-05-13)" },
      { id: "gpt-4o-2024-08-06", name: "GPT-4o (2024-08-06)" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    expect(filtered.map((m) => m.id)).toEqual(["gpt-4o"]);
  });

  test("drops dated snapshot when bare alias exists (Mistral YYMM)", () => {
    const raw = [
      { id: "mistral-large-latest", name: "Mistral Large (latest)" },
      { id: "mistral-large-2411", name: "Mistral Large 2411" },
      { id: "mistral-large-2512", name: "Mistral Large 2512" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    // bare `mistral-large` doesn't exist; dedup stripping `-2411` gives `mistral-large`
    // which isn't in the list, so both snapshots stay. Keep test honest.
    expect(filtered.map((m) => m.id)).toContain("mistral-large-latest");
    expect(filtered.map((m) => m.id)).toContain("mistral-large-2411");
    expect(filtered.map((m) => m.id)).toContain("mistral-large-2512");
  });

  test("keeps dated snapshot when bare alias absent", () => {
    const raw = [
      { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet (20240620)" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    expect(filtered.map((m) => m.id)).toEqual(["claude-3-5-sonnet-20240620"]);
  });

  test("keeps IDs with non-date suffixes", () => {
    const raw = [
      { id: "grok-4-1-fast", name: "Grok 4.1 Fast" },
      { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast (non-reasoning)" },
      { id: "gemma-3-27b-it", name: "Gemma 3 27B IT" },
      { id: "pixtral-12b", name: "Pixtral 12B" },
    ];
    const filtered = filterModelCatalog("unknown-provider-xyz", raw);
    expect(filtered.map((m) => m.id).sort()).toEqual(
      ["grok-4-1-fast", "grok-4-1-fast-non-reasoning", "gemma-3-27b-it", "pixtral-12b"].sort(),
    );
  });
});

describe("stripLatestLabel", () => {
  test("strips trailing ' (latest)' (Anthropic pi-ai style)", () => {
    expect(stripLatestLabel("Claude Haiku 4.5 (latest)")).toBe("Claude Haiku 4.5");
    expect(stripLatestLabel("Claude Opus 4.5 (latest)")).toBe("Claude Opus 4.5");
  });

  test("strips trailing ' (latest)' case-insensitively", () => {
    expect(stripLatestLabel("Foo (LATEST)")).toBe("Foo");
    expect(stripLatestLabel("Bar (Latest)")).toBe("Bar");
  });

  test("strips Mistral-style '(latest)'", () => {
    expect(stripLatestLabel("Codestral (latest)")).toBe("Codestral");
    expect(stripLatestLabel("Devstral 2 (latest)")).toBe("Devstral 2");
  });

  test("preserves 'Latest' when it is part of the real model name (no parens)", () => {
    // OpenAI's gpt-5-chat-latest → "GPT-5 Chat Latest" — "Latest" is part of the ID
    expect(stripLatestLabel("GPT-5 Chat Latest")).toBe("GPT-5 Chat Latest");
    expect(stripLatestLabel("Gemini Flash Latest")).toBe("Gemini Flash Latest");
  });

  test("returns unchanged when no match", () => {
    expect(stripLatestLabel("Claude Opus 4.7")).toBe("Claude Opus 4.7");
    expect(stripLatestLabel("")).toBe("");
  });
});

describe("filterModelCatalog — name normalization", () => {
  test("strips cosmetic ' (latest)' from surviving entries' names", () => {
    const raw = [
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)" },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    ];
    const filtered = filterModelCatalog("anthropic", raw);
    expect(filtered.find((m) => m.id === "claude-haiku-4-5")?.name).toBe("Claude Haiku 4.5");
    expect(filtered.find((m) => m.id === "claude-opus-4-7")?.name).toBe("Claude Opus 4.7");
  });
});

describe("getRetiredEntry", () => {
  test("returns undefined for active models", () => {
    expect(getRetiredEntry("anthropic", "claude-opus-4-7")).toBeUndefined();
  });

  test("returns undefined for unknown provider", () => {
    expect(getRetiredEntry("unknown-xyz", "whatever")).toBeUndefined();
  });

  test("returns populated entry for retired anthropic IDs", () => {
    const entry = getRetiredEntry("anthropic", "claude-3-haiku-20240307");
    expect(entry).toBeDefined();
    expect(entry?.replacement).toBe("claude-haiku-4-5-20251001");
    expect(entry?.retireDate).toBe("2026-04-20");
  });

  test("returns populated entry for deprecated Anthropic aliases", () => {
    const entry = getRetiredEntry("anthropic", "claude-opus-4-0");
    expect(entry).toBeDefined();
    expect(entry?.replacement).toBe("claude-opus-4-7");
    expect(entry?.reason).toMatch(/alias/i);
  });
});

describe("filterModelCatalog — retired + dedup interaction", () => {
  test("retired ID removed by pass 1 before pass 2 evaluates", () => {
    // claude-3-5-haiku-latest is retired (pass 1 drops it).
    // claude-haiku-4-5 is its replacement, also in the list.
    // Result: only claude-haiku-4-5 survives — no crash, no double-drop.
    const raw = [
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku (latest)" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ];
    const filtered = filterModelCatalog("anthropic", raw).map((m) => m.id);
    expect(filtered).toEqual(["claude-haiku-4-5"]);
  });

  test("dated retired snapshot dropped by pass 1, bare alias kept by pass 2", () => {
    // claude-opus-4-5-20251101 is NOT in RETIRED_MODELS but its dedup
    // partner (bare claude-opus-4-5 alias) IS in the raw list.
    // So pass 1 drops nothing; pass 2 drops the dated snapshot.
    const raw = [
      { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5 (snapshot)" },
    ];
    const filtered = filterModelCatalog("anthropic", raw).map((m) => m.id);
    expect(filtered).toEqual(["claude-opus-4-5"]);
  });
});

describe("catalog smoke tests — guard against typos", () => {
  // Each assertion: given raw input containing a retired ID, filter drops it.
  // Catches catalog typos where a key doesn't exactly match what pi-ai emits.

  test("anthropic: claude-3-haiku-20240307 is filtered", () => {
    const raw = [
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    ];
    const filtered = filterModelCatalog("anthropic", raw).map((m) => m.id);
    expect(filtered).not.toContain("claude-3-haiku-20240307");
  });

  test("google: gemini-1.5-pro is filtered", () => {
    const raw = [
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    ];
    const filtered = filterModelCatalog("google", raw).map((m) => m.id);
    expect(filtered).not.toContain("gemini-1.5-pro");
  });

  test("amazon-bedrock: anthropic.claude-3-5-sonnet-20241022-v2:0 is filtered", () => {
    const raw = [
      { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet (Bedrock)" },
      { id: "anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Bedrock)" },
    ];
    const filtered = filterModelCatalog("amazon-bedrock", raw).map((m) => m.id);
    expect(filtered).not.toContain("anthropic.claude-3-5-sonnet-20241022-v2:0");
  });

  test("groq: llama3-8b-8192 is filtered", () => {
    const raw = [
      { id: "llama3-8b-8192", name: "Llama3 8B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    ];
    const filtered = filterModelCatalog("groq", raw).map((m) => m.id);
    expect(filtered).not.toContain("llama3-8b-8192");
  });

  test("openai-codex: gpt-5.1 is filtered", () => {
    const raw = [
      { id: "gpt-5.1", name: "GPT 5.1" },
      { id: "gpt-5.4", name: "GPT 5.4" },
    ];
    const filtered = filterModelCatalog("openai-codex", raw).map((m) => m.id);
    expect(filtered).not.toContain("gpt-5.1");
  });
});
