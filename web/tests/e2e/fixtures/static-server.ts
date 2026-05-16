/**
 * Minimal static server that mimics the Ghost gateway's SPA layout:
 *   GET /              → index.html (SPA shell)
 *   GET /_app/*        → static asset from dist/
 *   GET /<any-route>   → index.html (SPA fallback for react-router)
 *
 * Used only by Playwright's webServer. This exists because `vite preview`
 * won't serve the SPA shell at non-`/_app/` paths — in production the
 * ElysiaJS gateway in src/gateway/server.ts handles that rewrite.
 *
 * Run with: bun run tests/e2e/fixtures/static-server.ts [port]
 */
import { file } from 'bun';
import { resolve, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const distDir = resolve(import.meta.dir, '../../../dist');
const indexHtml = join(distDir, 'index.html');

function safeJoin(base: string, unsafePath: string): string | null {
  // Strip leading slashes before joining, then verify the result stays under base.
  const target = normalize(join(base, unsafePath.replace(/^\/+/, '')));
  if (!target.startsWith(base)) return null;
  return target;
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Static assets live under /_app/
    if (pathname.startsWith('/_app/')) {
      const sub = pathname.slice('/_app/'.length);
      const target = safeJoin(distDir, sub);
      if (!target) return new Response('Bad path', { status: 400 });
      const f = file(target);
      if (await f.exists()) return new Response(f);
      return new Response('Not Found', { status: 404 });
    }

    // Favicon and a couple of root-level static files that Vite emits.
    if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
      const f = file(join(distDir, 'favicon.svg'));
      if (await f.exists()) return new Response(f);
    }

    // SPA fallback — any other GET gets index.html so react-router can route.
    if (req.method === 'GET') {
      return new Response(file(indexHtml), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Method Not Allowed', { status: 405 });
  },
});

console.log(`static-server listening on http://localhost:${server.port}`);
