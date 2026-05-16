/**
 * Resolve X/Twitter GraphQL query IDs from the frontend JS bundle.
 * Falls back to hardcoded defaults if fetch fails.
 *
 * Instance-based so tests and separate runtimes don't share cached state.
 */

const DEFAULTS: Record<string, string> = {
  UserByScreenName: "IGgvgiOx4QZndDHuD3x9TQ",
  UserTweets: "x3B_xLqC0yZawOB7WQhaVQ",
};

const CACHE_TTL_MS = 24 * 3600 * 1000; // refresh once per day

export class XQueryIdCache {
  private cached: Record<string, string> | null = null;
  private lastFetch = 0;

  /** Returns the query ID for an X GraphQL operation, or '' if unavailable. */
  async getQueryId(operation: string): Promise<string> {
    const now = Date.now();
    if (!this.cached || now - this.lastFetch > CACHE_TTL_MS) {
      try {
        this.cached = await fetchFromBundle();
        this.lastFetch = now;
      } catch {
        // Keep old cache or defaults on fetch failure
      }
    }
    return this.cached?.[operation] ?? DEFAULTS[operation] ?? "";
  }

  /** Force refresh on next getQueryId call — e.g. after a "Query not found" response. */
  invalidate(): void {
    this.cached = null;
    this.lastFetch = 0;
  }
}

async function fetchFromBundle(): Promise<Record<string, string>> {
  const html = await fetch("https://x.com", {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  }).then((r) => r.text());

  const jsUrl = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"]+\.js/)?.[0];
  if (!jsUrl) throw new Error("main.js not found");

  const js = await fetch(jsUrl, { signal: AbortSignal.timeout(15_000) }).then((r) => r.text());
  const ids: Record<string, string> = {};
  const re = /queryId:"([^"]+)",operationName:"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) ids[m[2]] = m[1];
  return ids;
}
