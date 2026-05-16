
import type { MethodHandler } from "./method-registry.js";
import type { ToolRegistry } from "../tools/registry.js";

export function registerToolsMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { tools: ToolRegistry },
): void {
  register("tools.list", async () => ({
    tools: deps.tools.all().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }));
}
