import type { MethodHandler } from "./method-registry.js";
import type { SkillService } from "../services/skill-service.js";

const SYNC_INTERVAL_MS = 5_000;

export function registerSkillsMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { skillService: SkillService },
): void {
  let lastSyncMs = 0;

  register("skills.list", async () => {
    const now = Date.now();
    if (now - lastSyncMs > SYNC_INTERVAL_MS) {
      deps.skillService.syncState();
      lastSyncMs = now;
    }
    return { skills: deps.skillService.listSkills() };
  });

  register("skills.toggle", async (_ctx, payload) => {
    const { name, enabled } = payload as { name: string; enabled: boolean };
    if (typeof name !== "string" || typeof enabled !== "boolean") {
      throw new Error("Invalid payload: expected { name: string, enabled: boolean }");
    }
    deps.skillService.toggleSkill(name, enabled);
    return { ok: true };
  });

  register("skills.delete", async (_ctx, payload) => {
    const { name } = payload as { name: string };
    if (typeof name !== "string") {
      throw new Error("Invalid payload: expected { name: string }");
    }
    return deps.skillService.deleteSkill(name);
  });
}
