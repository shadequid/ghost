import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  count: Type.Optional(Type.Number({ description: "Number of results (default: 5, max: 10)", minimum: 1, maximum: 10 })),
});

export interface WebSearchConfig {
  provider: "brave" | "duckduckgo";
  apiKey?: string;
  maxResults?: number;
}

export class WebSearchTool implements AgentTool<typeof WebSearchSchema> {
  readonly name = "web_search";
  readonly label = "Web Search";
  readonly description = "Search the web and return results with title, URL, and snippet.";
  readonly parameters = WebSearchSchema;

  constructor(private readonly config?: WebSearchConfig) {}

  async execute(
    _toolCallId: string,
    params: Static<typeof WebSearchSchema>,
  ): Promise<AgentToolResult<{ resultCount: number }>> {
    const count = params.count ?? this.config?.maxResults ?? 5;
    const provider = this.config?.provider ?? "duckduckgo";

    if (provider === "brave") {
      return this.searchBrave(params.query, count);
    }
    return this.searchDuckDuckGo(params.query, count);
  }

  private async searchBrave(query: string, count: number): Promise<AgentToolResult<{ resultCount: number }>> {
    const apiKey = this.config?.apiKey ?? Bun.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) throw new Error("No search provider configured. Set BRAVE_SEARCH_API_KEY.");

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
    });
    if (!resp.ok) throw new Error(`Brave search failed: HTTP ${resp.status}`);

    const data = await resp.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    const results = data.web?.results ?? [];

    const text = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`,
    ).join("\n\n") || "No results found.";

    return {
      content: [{ type: "text", text }],
      details: { resultCount: results.length },
    };
  }

  private async searchDuckDuckGo(query: string, count: number): Promise<AgentToolResult<{ resultCount: number }>> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Ghost/1.0" },
    });
    if (!resp.ok) throw new Error(`DuckDuckGo search failed: HTTP ${resp.status}`);

    const html = await resp.text();
    const parts: string[] = [];

    // Extract result links: <a class="result__a" href="...">Title</a>
    const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    // Extract snippets: <a class="result__snippet...">...</a>
    const snippetRegex = /<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

    const links: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null && links.length < count) {
      links.push({ url: decodeDdgRedirectUrl(match[1]), title: stripTags(match[2]).trim() });
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < count) {
      snippets.push(stripTags(match[1]).trim());
    }

    for (let i = 0; i < links.length; i++) {
      const snippet = snippets[i] ? `\n   ${snippets[i]}` : "";
      parts.push(`${i + 1}. ${links[i].title}\n   ${links[i].url}${snippet}`);
    }

    const text = parts.join("\n\n") || "No results found.";
    return {
      content: [{ type: "text", text }],
      details: { resultCount: parts.length },
    };
  }
}

/** Decode DuckDuckGo redirect URL to extract the actual destination URL. */
function decodeDdgRedirectUrl(rawUrl: string): string {
  const idx = rawUrl.indexOf("uddg=");
  if (idx !== -1) {
    const encoded = rawUrl.slice(idx + 5).split("&")[0];
    try { return decodeURIComponent(encoded); } catch { /* fall through */ }
  }
  return rawUrl;
}

/** Remove HTML tags from content. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
