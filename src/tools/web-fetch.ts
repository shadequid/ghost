import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { isPrivateIp, validateUrlSafety } from "../helpers/url-safety.js";

// Re-export for backward compatibility
export { isPrivateIp };

const WebFetchSchema = Type.Object({
  url: Type.String({ description: "URL to fetch (http:// or https:// only)" }),
  extractMode: Type.Optional(Type.Union([
    Type.Literal("markdown"),
    Type.Literal("text"),
  ], { description: "Content extraction mode (default: text)" })),
  maxChars: Type.Optional(Type.Number({ description: "Max chars to return (default: 50000)", minimum: 100 })),
});

const MAX_CHARS = 50_000;

export class WebFetchTool implements AgentTool<typeof WebFetchSchema> {
  readonly name = "web_fetch";
  readonly label = "Web Fetch";
  readonly description = "Fetch content from a URL with SSRF protection.";
  readonly parameters = WebFetchSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof WebFetchSchema>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<{ status: number; url: string; finalUrl: string; truncated: boolean }>> {
    const { url, maxChars = MAX_CHARS } = params;

    await validateUrlSafety(url);

    // Walk the redirect chain manually so each hop is validated before the
    // request fires. redirect:"follow" would execute intermediate hops to
    // private addresses (e.g. 169.254.169.254) before we could inspect them.
    const sig = signal ?? AbortSignal.timeout(30_000);
    let currentUrl = url;
    let response: Response;
    const MAX_REDIRECTS = 10;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(currentUrl, { signal: sig, redirect: "manual" });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        // Resolve relative redirects against the current URL
        const nextUrl = new URL(location, currentUrl).toString();
        await validateUrlSafety(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      break;
    }

    // TypeScript narrowing — response is always assigned after the loop
    // (the loop runs at least once; break exits with response set).
    const finalResponse = response!;
    const finalUrl = currentUrl;

    if (!finalResponse.ok) throw new Error(`HTTP ${finalResponse.status}: ${finalResponse.statusText}`);

    const raw = await finalResponse.text();
    const truncated = raw.length > maxChars;
    const text = truncated ? raw.slice(0, maxChars) + "\n... (truncated)" : raw;

    const result = JSON.stringify({
      url,
      finalUrl,
      status: finalResponse.status,
      truncated,
      length: raw.length,
      text,
    }, null, 2);

    return {
      content: [{ type: "text", text: result }],
      details: { status: finalResponse.status, url, finalUrl, truncated },
    };
  }
}
