# Update

Ghost is in early access. There are no published packages — update by pulling the latest code from the repository.

## Update Procedure

```bash
git pull
bun install
```

This updates your local clone and dependencies to the latest development version. Your config, wallets, chat history, memory, and skills in `~/.ghost/` are never touched.

## VersionCheckService (Dormant)

The in-repo VersionCheckService (`src/update/version-check.ts`) exists but is dormant until a registry is created. The service is wired but has no effect on dev-clone installs.

When Ghost ships with a published registry, version checking will resume. See code comments in `src/update/` for architecture.
