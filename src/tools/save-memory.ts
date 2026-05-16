/** SaveMemoryTool — persists memory consolidation results to HISTORY.md + MEMORY.md. */

import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { MemoryStore } from "../memory/store.js";

const SaveMemorySchema = Type.Object({
  history_entry: Type.String({
    description:
      "Paragraph summarizing key events, decisions, topics from the chunk. " +
      "Start with [YYYY-MM-DD HH:MM]. Grep-searchable.",
  }),
  memory_update: Type.String({
    description:
      "Full updated long-term memory as markdown. Include ALL existing facts " +
      "plus any new ones. Return unchanged if nothing new to add.",
  }),
});

export class SaveMemoryTool implements AgentTool<typeof SaveMemorySchema> {
  readonly name = "save_memory";
  readonly label = "Save Memory";
  readonly description =
    "Append an entry to HISTORY.md and update MEMORY.md. Use to persist " +
    "facts, decisions, and preferences worth remembering across sessions. " +
    "The memory consolidator also uses this tool to roll up old conversation " +
    "history when context budget pressure builds.";
  readonly parameters = SaveMemorySchema;

  constructor(private readonly store: MemoryStore) {}

  async execute(
    _toolCallId: string,
    args: Static<typeof SaveMemorySchema>,
  ): Promise<AgentToolResult<{ written: boolean }>> {
    const history = args.history_entry?.trim();
    const memory = args.memory_update?.trim();
    if (!history || !memory) {
      return {
        content: [{ type: "text", text: "Error: history_entry and memory_update are required" }],
        details: { written: false },
      };
    }
    this.store.appendHistory(history);
    await this.store.writeLongTerm(memory);
    return {
      content: [{ type: "text", text: "Memory saved." }],
      details: { written: true },
    };
  }
}
