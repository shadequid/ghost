/**
 * Resolves the Claude Code native binary path explicitly so the SDK doesn't
 * have to choose for us.
 *
 * Why: `@anthropic-ai/claude-agent-sdk` resolves its native binary by probing
 * its own optional dependencies in a fixed order — musl variants first, glibc
 * variants second. When both packages are installed (Bun does this by default
 * on Linux), the musl binary wins, and on a glibc host its ELF interpreter
 * `/lib/ld-musl-x86_64.so.1` is absent — `exec()` returns ENOENT and the SDK
 * raises "native binary not found".
 *
 * We side-step that by detecting libc ourselves via the presence of the musl
 * loader and resolving the matching package through Node's module algorithm.
 * On non-Linux platforms we return `undefined` so the SDK keeps its default
 * (macOS and Windows pick their variants correctly).
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Logger } from "pino";

const require = createRequire(import.meta.url);

function detectLinuxVariant(): "musl" | "gnu" {
  // The musl loader is always present on musl-based distros (Alpine, void).
  // x64 and arm64 each have their own loader path; either one is enough to
  // signal "this host runs musl".
  const muslLoaderExists =
    existsSync("/lib/ld-musl-x86_64.so.1") ||
    existsSync("/lib/ld-musl-aarch64.so.1");
  return muslLoaderExists ? "musl" : "gnu";
}

function platformPackageName(logger?: Logger): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    if (arch !== "x64" && arch !== "arm64") {
      logger?.warn(
        { platform, arch },
        "claude-cli: unsupported Linux arch; falling back to SDK default binary resolution",
      );
      return null;
    }
    const suffix = detectLinuxVariant() === "musl" ? "-musl" : "";
    return `@anthropic-ai/claude-agent-sdk-linux-${arch}${suffix}`;
  }

  // macOS and Windows: SDK default is correct there.
  return null;
}

/**
 * Returns an absolute path to the `claude` native binary that matches the
 * host's libc, or `undefined` if the SDK should fall back to its own
 * detection (non-Linux platforms, or when the expected package is missing).
 *
 * Pass a logger to get a breadcrumb whenever we fall back — silent fallback
 * defeats the purpose of pinning, since the SDK's default is the broken path
 * we're trying to avoid.
 */
export function resolveClaudeCodeBinary(logger?: Logger): string | undefined {
  const pkgName = platformPackageName(logger);
  if (!pkgName) return undefined;

  try {
    // Resolve through the main SDK package so we land in the correct
    // node_modules tree even with hoisting / workspaces.
    const sdkPkgJson = require.resolve("@anthropic-ai/claude-agent-sdk/package.json");
    const anthropicDir = dirname(dirname(sdkPkgJson)); // .../@anthropic-ai
    const variantDir = pkgName.split("/").pop()!; // claude-agent-sdk-linux-x64
    const binaryPath = join(anthropicDir, variantDir, "claude");
    if (!existsSync(binaryPath)) {
      logger?.warn(
        { pkgName, binaryPath },
        "claude-cli: expected native binary missing on disk; falling back to SDK default",
      );
      return undefined;
    }
    return binaryPath;
  } catch (err) {
    logger?.warn(
      { pkgName, err },
      "claude-cli: failed to resolve SDK package path; falling back to SDK default",
    );
    return undefined;
  }
}
