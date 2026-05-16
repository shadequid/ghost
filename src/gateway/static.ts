import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

function mime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve the path to the built web dashboard `dist/` directory.
 * Prefers import.meta.dir-relative candidates (production install) over cwd (last resort).
 *
 * @param candidates Optional override for testing. Defaults to production list.
 */
export function resolveWebDist(candidates?: string[]): string | null {
  const list = candidates ?? defaultWebDistCandidates();
  for (const c of list) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return null;
}

function defaultWebDistCandidates(): string[] {
  return [
    join(import.meta.dir, "web", "dist"),
    join(import.meta.dir, "..", "..", "web", "dist"),
    join(process.cwd(), "web", "dist"),
  ];
}

/**
 * Serve a static file from the web dist directory.
 * Returns `null` if the dist directory is not found or the file doesn't exist.
 */
export async function serveStatic(
  distDir: string,
  urlPath: string,
): Promise<Response | null> {
  // Strip the /_app/ prefix that Vite uses as its base
  const stripped = urlPath.startsWith("/_app/")
    ? urlPath.slice("/_app/".length)
    : urlPath.slice(1); // strip leading /

  const filePath = join(distDir, stripped);

  // Security: ensure the resolved path stays within distDir
  if (!filePath.startsWith(distDir)) return null;

  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  return new Response(file, {
    headers: { "Content-Type": mime(filePath), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}

/**
 * Serve the SPA `index.html` for all non-API GET requests.
 * This enables client-side routing in the React app.
 */
export async function serveSpaFallback(distDir: string): Promise<Response> {
  const file = Bun.file(join(distDir, "index.html"));
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
