---
name: skill-creator
description: Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets.
---

# Skill Creator

Create effective, modular skills for Ghost. For detailed principles, anatomy, naming conventions, and progressive disclosure patterns, see [references/guide.md](references/guide.md).

## Quick Reference

```
skill-name/
├── SKILL.md          (required — frontmatter + instructions)
├── scripts/          (deterministic, reusable code)
├── references/       (docs loaded on demand)
└── assets/           (templates, images for output)
```

**Ghost custom skills location:** `~/.ghost/workspace/skills/<skill-name>/SKILL.md`

## Creation Process

### Step 1: Understand — Gather Concrete Examples

Ask the user:
- What should this skill do? What are specific use cases?
- What would a user say that should trigger this skill?
- What variations or edge cases exist?

Skip only when usage patterns are already clearly understood.

### Step 2: Plan — Identify Reusable Contents

For each use case, analyze:
1. What code gets rewritten each time? → `scripts/`
2. What documentation is needed for context? → `references/`
3. What files appear in the output? → `assets/`

### Step 3: Initialize — Create Directory Structure

```bash
mkdir -p ~/.ghost/workspace/skills/<skill-name>
```

Create SKILL.md with proper frontmatter. Add resource directories as needed.

### Step 4: Edit — Implement the Skill

1. **Start with bundled resources** — scripts, references, assets. Test scripts by running them.
2. **Write SKILL.md:**
   - **Frontmatter:** `name` + `description` (include all trigger phrases — body is only loaded after triggering)
   - **Body:** Imperative form. Only include what's non-obvious to the agent. Keep under 500 lines.

### Step 5: Package — Validate and Distribute

Validate:
- YAML frontmatter format and required fields
- Naming conventions (lowercase, hyphens, <64 chars)
- Description completeness
- No symlinks (security restriction)

### Step 6: Iterate — Improve from Real Usage

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Update SKILL.md or bundled resources
4. Test again
