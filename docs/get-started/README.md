# Get Started

Quick guides to install, understand, and use Ghost.

## Contents

- [What is Ghost?](./what-is-ghost.md) — Product overview, who Ghost is for, what makes it different
- [Installation](./installation.md) — Install, onboard, verify setup
- [Your First Conversation](./first-conversation.md) — Annotated example: real Ghost chat session
- [Paper Trading First](./paper-trading-first.md) — Simulate trades risk-free before going live
- [CLI Commands](./cli-commands.md) — Complete command reference
- [How to Ask Ghost](./asking-ghost.md) — Prompt patterns for every workflow

## Quick Start

Ghost is in early access — install by cloning the repo:

```bash
# 1. Clone + install
git clone https://github.com/hyperflowdotfun/ghost.git && cd ghost
bun install && cd web && bun install && cd ..

# 2. Setup (interactive)
bun run dev onboard --paper     # $10k simulated capital

# 3. Start
bun run dev                     # Opens http://localhost:15401

# 4. Chat
# Visit web dashboard or connect Telegram
# "Show me my portfolio"
```

Start with [What is Ghost?](./what-is-ghost.md) if you're new.
