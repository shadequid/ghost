/**
 * Tests for SaveMemoryTool.
 *
 * 3 cases:
 *   1. Happy path — valid args → appendHistory + writeLongTerm called, returns written:true
 *   2. Missing args — empty history_entry or memory_update → returns error, no store writes
 *   3. Store throws — error propagates from execute()
 */

import { describe, test, expect, mock } from "bun:test";
import { SaveMemoryTool } from "../../src/tools/save-memory.js";
import type { MemoryStore } from "../../src/memory/store.js";

// ---------------------------------------------------------------------------
// Minimal MemoryStore mock
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<{
  appendHistory: () => void;
  writeLongTerm: () => Promise<void>;
}> = {}): MemoryStore {
  return {
    appendHistory: overrides.appendHistory ?? mock(() => {}),
    writeLongTerm: overrides.writeLongTerm ?? mock(async () => {}),
    readLongTerm: mock(() => ""),
    getMemoryContext: mock(() => ""),
    healthCheck: mock(() => true),
  } as unknown as MemoryStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SaveMemoryTool — happy path", () => {
  test("calls appendHistory and writeLongTerm with trimmed values", async () => {
    const store = makeStore();
    const tool = new SaveMemoryTool(store);

    const result = await tool.execute("tc-1", {
      history_entry: "[2026-05-11 09:00] User discussed BTC positions",
      memory_update: "# Facts\nUser prefers BTC longs.",
    });

    expect(store.appendHistory).toHaveBeenCalledTimes(1);
    expect((store.appendHistory as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "[2026-05-11 09:00] User discussed BTC positions",
    );
    expect(store.writeLongTerm).toHaveBeenCalledTimes(1);
    expect((store.writeLongTerm as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
      "# Facts\nUser prefers BTC longs.",
    );
    expect(result.details.written).toBe(true);
    expect(result.content[0].type).toBe("text");
  });

  test("tool has correct name and label", () => {
    const tool = new SaveMemoryTool(makeStore());
    expect(tool.name).toBe("save_memory");
    expect(tool.label).toBe("Save Memory");
  });
});

describe("SaveMemoryTool — missing args", () => {
  test("returns error when history_entry is empty", async () => {
    const store = makeStore();
    const tool = new SaveMemoryTool(store);

    const result = await tool.execute("tc-2", {
      history_entry: "   ",
      memory_update: "# Memory",
    });

    expect(result.details.written).toBe(false);
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { type: string; text: string }).text).toContain("Error");
    expect(store.appendHistory).not.toHaveBeenCalled();
    expect(store.writeLongTerm).not.toHaveBeenCalled();
  });

  test("returns error when memory_update is empty", async () => {
    const store = makeStore();
    const tool = new SaveMemoryTool(store);

    const result = await tool.execute("tc-3", {
      history_entry: "[2026-05-11] Some event",
      memory_update: "",
    });

    expect(result.details.written).toBe(false);
    expect(store.appendHistory).not.toHaveBeenCalled();
    expect(store.writeLongTerm).not.toHaveBeenCalled();
  });
});

describe("SaveMemoryTool — store throws", () => {
  test("error from writeLongTerm propagates out of execute()", async () => {
    const store = makeStore({
      writeLongTerm: mock(async () => { throw new Error("disk full"); }),
    });
    const tool = new SaveMemoryTool(store);

    await expect(
      tool.execute("tc-4", {
        history_entry: "[2026-05-11] Event",
        memory_update: "# Memory",
      }),
    ).rejects.toThrow("disk full");
  });
});
