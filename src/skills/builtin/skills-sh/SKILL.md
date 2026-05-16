---
name: skills-sh
description: "Search and install agent skills from skills.sh, the open skill directory. Triggers: find a skill, search skills, install skill, skills.sh, skill directory"
metadata: {"ghost":{"emoji":"🔮","requires":{"bins":["npx"]}}}
---

# skills.sh

Open skill directory for AI agents (91,000+ skills). Search by keyword.

## When to use

Use this skill when the user asks any of:
- "find a skill on skills.sh"
- "search skills.sh"
- "install a skill from skills.sh"
- "what skills are on skills.sh?"

## Search

```bash
npx --yes skills find react
```

## Install

**Step 1:** Install the skill globally:
```bash
npx --yes skills add <owner/repo@skill-name> -g -y --copy
```

**Step 2:** Move to Ghost workspace. The CLI installs to `$HOME/.agents/skills/` or `$HOME/.claude/skills/` depending on the detected agent. Check which one has the skill, then move:
```bash
mv $HOME/.agents/skills/<skill-name> $HOME/.ghost/workspace/skills/ 2>/dev/null || mv $HOME/.claude/skills/<skill-name> $HOME/.ghost/workspace/skills/
```

Replace `<owner/repo@skill-name>` with the source from search results. Replace `<skill-name>` with the installed directory name.

## List installed (skills.sh registry)

```bash
npx --yes skills list -g
```

## Update

```bash
npx --yes skills update
```

## Notes

- Requires Node.js (`npx` comes with it).
- No API key needed for search and install.
- Always use `-g --copy` flags to install globally with real files (not symlinks).
- The CLI may install to `$HOME/.agents/skills/` or `$HOME/.claude/skills/` — always check both and move to `$HOME/.ghost/workspace/skills/`.
