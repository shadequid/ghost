# Security & Policy

Ghost's security model is built on three pillars: **trust boundaries**, **autonomy levels**, and **confirmation gates**. No in-app authentication exists on the gateway — the entire trust model relies on loopback binding + pairing allowlist.

## Threat Model

| Asset | Store | Exposure | Mitigation |
|-------|-------|----------|-----------|
| Config (provider, model, keys) | ~/.ghost/config.json | Disk access | File permissions (0o600) |
| OAuth tokens | ~/.ghost/credentials.json | Disk + memory | AES-256-GCM encryption (enc2: prefix) |
| Trading private keys | credentials.json | Disk + memory | Same encryption as above |
| Pairing allowlist | SQLite DB | Local only | Database access control |
| Session tokens | gateway_sessions table | Bearer token auth | Revoked on channel unpairing |

**Trust boundary:**
- **Loopback only:** Gateway listens on `127.0.0.1:15401`. Only 127.0.0.1 can issue RPC calls. Safe for single-user installs. The daemon refuses to start on any non-loopback host. See `docs/security/network-exposure.md`.

## Autonomy Levels

Defined in `src/security/policy.ts:48-180`. Each level gates tool and command execution:

| Level | Tool Operations | Command Risk | Use Case |
|-------|-----------------|--------------|----------|
| read_only | Reads only (list_dir, read_file, web_fetch, web_search) | All commands blocked | Audit-only, no state changes |
| interactive | Reads + low-risk acts | User must approve each medium+ risk | Single-user development |
| supervised | Reads + acts | Agent must confirm before medium+ risk | Active trading with approval |
| full | All tools, all commands | No approval required | Paper trading, isolated sandbox |

## Risk Classification

**HIGH risk** commands (src/security/policy.ts:9-13) — blocked entirely unless approved:
- File/disk: `rm`, `rmdir`, `dd`, `mkfs`, `format`
- Privilege: `sudo`, `su`, `chmod`, `chown`
- System: `shutdown`, `reboot`, `mount`, `umount`
- Network: `curl`, `wget`, `nc`, `netcat`, `ssh`, `scp`, `ftp`, `iptables`, `ufw`

**MEDIUM risk** commands (src/security/policy.ts:16-24) — require approval in supervised mode:
- File ops: `touch`, `mkdir`, `mv`, `cp`, `ln`
- VCS: `git commit`, `git push`, `git reset`, `git rebase`, `git merge`, `git cherry-pick`
- Package: `npm install`, `npm add`, `bun install`, `bun add`, `bun remove`

**LOW risk** commands — always allowed in interactive/supervised/full:
- Reads: `ls`, `cat`, `grep`, `find`, `head`, `tail`, `wc`, `pwd`, `date`, `df`, `du`, `uname`, etc.

## Confirmation Gates (Confirmable Tools)

**8 trading tools require explicit user confirmation** before execution (src/services/confirm-policy.ts:31-40):
1. `ghost_place_order` — position entry
2. `ghost_cancel_order` — order cancellation
3. `ghost_cancel_all_orders` — bulk cancellation
4. `ghost_emergency_close` — force-close position
5. `ghost_set_sl_tp` — stop-loss / take-profit
6. `ghost_bracket_order` — entry with auto-SL/TP
7. `ghost_partial_close` — reduce position
8. `ghost_adjust_margin` — leverage adjustment

Confirm cards display trade details (side, entry, SL, TP, size, risk) for human review. Card format is mechanical (not LLM-authored) to ensure determinism and auditability.

## Leak Detection

**LeakDetector** scrubs credentials from tool output in real-time (src/security/leak-detector.ts:1-99). Patterns:

| Pattern | Shape | Example |
|---------|-------|---------|
| Stripe | `pk_live/test_[A-Za-z0-9]{24,}` | pk_live_abc123… |
| OpenAI | `sk-[A-Za-z0-9]{48,}` (not sk-ant-) | sk-proj123… |
| Anthropic | `sk-ant-[A-Za-z0-9]{32,}` | sk-ant-abc… |
| AWS Access | `AKIA[A-Z0-9]{16}` | AKIA123456789ABC |
| Private Keys | BEGIN/END RSA|EC|OPENSSH envelope | -----BEGIN PRIVATE KEY----- |
| JWT | `eyJ[...].eyJ[...].eyJ[...]` | eyJhbGc… |
| DB URLs | `{postgres|mysql|redis}://user:pass@host` | postgres://user:p@db |

Sensitivity tuning: `sensitivity <= 0.5` skips the broad `generic_secret` pattern to reduce false positives.

## Secrets at Rest

**Format:** `enc2:` prefix + AES-256-GCM ciphertext.

- **Key derivation:** 32-byte random key generated on first run, saved to `~/.ghost/SECRET` with `0o600` permissions (owner read/write only).
- **Encryption:** Nonce (12 bytes) || Ciphertext || Tag (16 bytes), hex-encoded.
- **Files encrypted:** `~/.ghost/config.json` (provider auth), `~/.ghost/credentials.json` (OAuth tokens, wallet keys, bot tokens).
- **Plaintext fields:** Any value without `enc2:` prefix is treated as plaintext and passed through unchanged (backward compat).

See `src/config/secrets.ts:14-101` for algorithm details (AES-256-GCM, AEAD).

## Pairing & Allowlist Model

Device pairing is the gateway's in-app authentication layer (src/pairing/store.ts, src/pairing/code.ts).

- **Code generation:** 8-char alphanumeric (A-Z, 2-9 charset excludes I, O, 1, 0 for readability) + uniqueness check across existing pending requests.
- **TTL:** 60 minutes (PAIRING_TTL_MS). Request expires automatically.
- **Rate limit:** Max 1 pending request per sender per channel (idempotent reuse); global cap 50 pending to prevent DoS.
- **Allowlist storage:** `channel_allowlist` table tracks approved devices by identity (Telegram user ID or username) + displayName.

When approved, a `gateway_sessions` bearer token is issued. See [Architecture: Channels](./channels.md) for the pairing flow.

## Path Traversal Protection

**6-layer validation** (src/security/policy.ts:190-258):
1. No null bytes.
2. No `..` path components.
3. No URL-encoded traversal (`%2f`, `..%2f`).
4. No `~user` forms (only `~/` allowed).
5. Absolute paths must stay within workspaceDir.
6. Forbidden prefixes rejected: `/etc`, `/root`, `/sys`, `/proc`, `~/.ssh`, `~/.aws`, `~/.gnupg`.

## Shell Injection Hardening

Quote-aware lexer (src/security/policy.ts:270-436) rejects unquoted:
- Command substitution: `` ` ``, `$()`, `${}`.
- I/O redirection: `<`, `>`, `>>` (unless quoted).
- Process substitution: `<()`, `>()`.
- Background execution: standalone `&`.
- Piping through `tee` (data exfiltration).

Operators `&&`, `||`, `;` are allowed as statement separators within the same security classification.

## Security Review Checklist

- [ ] Threat model assets and boundaries understood.
- [ ] Autonomy level matches use case (read_only, interactive, supervised, full).
- [ ] HIGH-risk commands are blocked or require explicit approval.
- [ ] Confirmable tools trigger user approval before trading.
- [ ] Secrets use `enc2:` prefix and key is protected at `0o600`.
- [ ] Pairing allowlist is maintained and old devices removed.
- [ ] Non-loopback binding is only enabled with external auth layer.

## Responsible Disclosure

**TODO:** Add security contact (security@example.com) to project README before production release.
