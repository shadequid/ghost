#!/usr/bin/env node
// Copies shipped assets into dist/ for the npm-native package.
// Runs after `bun run build:bundle`.
import { cpSync, chmodSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

function copyDir(srcRel, destRel) {
  const src = join(ROOT, srcRel);
  const dest = join(DIST, destRel);
  if (!existsSync(src)) {
    console.error(`[copy-assets] missing source: ${src}`);
    process.exit(1);
  }
  // Wipe stale destination so removed files don't linger across builds
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-assets] ${srcRel} -> dist/${destRel}`);
}

function copyFile(srcRel, destRel) {
  const src = join(ROOT, srcRel);
  const dest = join(DIST, destRel);
  if (!existsSync(src)) {
    console.error(`[copy-assets] missing source: ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  console.log(`[copy-assets] ${srcRel} -> dist/${destRel}`);
}

copyDir("src/templates", "templates");
copyDir("src/skills/builtin", "skills/builtin");
copyDir("web/dist", "web/dist");
// Copy a minimal package.json into dist/ (only fields needed at runtime for version lookup).
// The full package.json stays at the package root for npm/bun metadata; the dist/ copy is
// solely for getVersion() which reads it via import.meta.dir resolution.
const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const distPkg = { name: rootPkg.name, version: rootPkg.version };
const distPkgPath = join(DIST, "package.json");
writeFileSync(distPkgPath, JSON.stringify(distPkg, null, 2) + "\n");
console.log(`[copy-assets] package.json -> dist/package.json (minimal: name+version)`);

const entry = join(DIST, "index.js");
if (existsSync(entry)) {
  chmodSync(entry, 0o755);
  console.log(`[copy-assets] chmod +x dist/index.js`);
} else {
  console.error(`[copy-assets] dist/index.js missing — did bundle step run?`);
  process.exit(1);
}
