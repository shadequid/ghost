import type { SecurityPolicy } from "../security/policy.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@mariozechner/pi-ai";
import type { Logger } from "pino";
import type { WebSearchConfig } from "./web-search.js";
import type { CronService } from "../scheduler/service.js";
import type { MemoryStore } from "../memory/store.js";
import { ToolRegistry } from "./registry.js";
import { ReadFileTool } from "./read-file.js";
import { WriteFileTool } from "./write-file.js";
import { EditFileTool } from "./edit-file.js";
import { ListDirTool } from "./list-dir.js";
import { ExecTool } from "./exec.js";
import { WebSearchTool } from "./web-search.js";
import { WebFetchTool } from "./web-fetch.js";
import { CronTool } from "./cron.js";
import { SaveMemoryTool } from "./save-memory.js";

export { ToolRegistry } from "./registry.js";
export { ReadFileTool } from "./read-file.js";
export { WriteFileTool } from "./write-file.js";
export { EditFileTool } from "./edit-file.js";
export { ListDirTool } from "./list-dir.js";
export { ExecTool } from "./exec.js";
export { WebSearchTool } from "./web-search.js";
export type { WebSearchConfig } from "./web-search.js";
export { WebFetchTool } from "./web-fetch.js";

export { CronTool } from "./cron.js";
export { SaveMemoryTool } from "./save-memory.js";

export interface CreateToolRegistryOptions {
  cronService: CronService;
  defaultTimezone: string;
  webSearchConfig?: WebSearchConfig;
  memoryStore: MemoryStore;
  logger: Logger;
}

export function createToolRegistry(
  _security: SecurityPolicy,
  options: CreateToolRegistryOptions,
): ToolRegistry {
  const registry = new ToolRegistry(options.logger);
  const reg = (t: AgentTool<TSchema>) => registry.register(t);

  reg(new ReadFileTool() as AgentTool<TSchema>);
  reg(new WriteFileTool() as AgentTool<TSchema>);
  reg(new EditFileTool() as AgentTool<TSchema>);
  reg(new ListDirTool() as AgentTool<TSchema>);
  reg(new ExecTool() as AgentTool<TSchema>);
  reg(new WebSearchTool(options.webSearchConfig) as AgentTool<TSchema>);
  reg(new WebFetchTool() as AgentTool<TSchema>);

  reg(new CronTool(options.cronService, options.defaultTimezone) as AgentTool<TSchema>);
  reg(new SaveMemoryTool(options.memoryStore) as AgentTool<TSchema>);

  return registry;
}
