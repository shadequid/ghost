---
name: clawhub
description: "Search and install agent skills from ClawHub, the public skill registry. Triggers: find a skill, search skills, install skill, clawhub, marketplace, what skills are available"
metadata: {"ghost":{"emoji":"🦞","requires":{"bins":["npx"]}}}
---

# ClawHub

Public skill registry for AI agents. Search by natural language (vector search).

## When to use

Use this skill when the user asks any of:
- "find a skill for ..."
- "search for skills"
- "install a skill from clawhub"
- "what skills are available?"
- "update my skills"

## Search

```bash
npx --yes clawhub@latest search "web scraping" --limit 5
```

## Install

```bash
npx --yes clawhub@latest install <slug> --workdir $HOME/.ghost/workspace
```

Replace `<slug>` with the skill name from search results. This places the skill into `$HOME/.ghost/workspace/skills/`, where Ghost loads workspace skills from. Always include `--workdir`.

## Update

```bash
npx --yes clawhub@latest update --all --workdir $HOME/.ghost/workspace
```

## List installed

```bash
npx --yes clawhub@latest list --workdir $HOME/.ghost/workspace
```

## Notes

- Requires Node.js (`npx` comes with it).
- No API key needed for search and install.
- `--workdir $HOME/.ghost/workspace` is critical — without it, skills install to the current directory instead of the Ghost workspace.
