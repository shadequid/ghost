/**
 * File-based memory store.
 *
 * Two-layer storage:
 * - MEMORY.md: long-term facts (always loaded into system prompt)
 * - HISTORY.md: append-only timestamped log (grep-searchable)
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class MemoryStore {
  readonly memoryDir: string;
  readonly memoryFile: string;
  readonly historyFile: string;

  constructor(workspaceDir: string) {
    this.memoryDir = join(workspaceDir, "memory");
    this.memoryFile = join(this.memoryDir, "MEMORY.md");
    this.historyFile = join(this.memoryDir, "HISTORY.md");
    this.ensureDir();
  }

  /** Read long-term memory. Returns "" if file doesn't exist. */
  readLongTerm(): string {
    if (!existsSync(this.memoryFile)) return "";
    try {
      return readFileSync(this.memoryFile, "utf-8");
    } catch {
      return "";
    }
  }

  /** Overwrite long-term memory with new content. */
  async writeLongTerm(content: string): Promise<void> {
    this.ensureDir();
    await Bun.write(this.memoryFile, content);
  }

  /** Append a timestamped entry to the history log. */
  appendHistory(entry: string): void {
    this.ensureDir();
    appendFileSync(this.historyFile, entry.trimEnd() + "\n\n", "utf-8");
  }

  /** Format memory for injection into system prompt. */
  getMemoryContext(): string {
    const content = this.readLongTerm().trim();
    if (!content) return "";
    return `## Long-term Memory\n\n${content}`;
  }

  /** Check that workspace/memory/ directory exists and is accessible. */
  healthCheck(): boolean {
    return existsSync(this.memoryDir);
  }

  private ensureDir(): void {
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }
  }
}
