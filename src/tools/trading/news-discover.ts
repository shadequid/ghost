/**
 * News discovery and management tools — site-URL-to-feed flow via RssDiscoveryService.
 *
 * The filter prompt is no longer exposed as a chat tool. Users edit it via
 * the "News Filter" modal in the web UI, which writes the same
 * `news.filter_prompt` PreferenceStore key the background evaluator reads.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { NewsService } from "../../services/news.js";
import type { RssDiscoveryService } from "../../services/rss-discovery.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";

export function createNewsTools(
  news: NewsService,
  rssDiscovery: RssDiscoveryService,
): AnyAgentTool[] {
  return [
    {
      name: "ghost_news_discover_rss",
      label: "News — Discover RSS Feed",
      description:
        "Find the RSS / Atom feed for a website. Use this when the user asks to add a news source by site name " +
        "(e.g. 'add CoinDesk to news'). Always show the user the candidate(s) returned by this tool and ask them " +
        "to confirm before calling ghost_news_add_source. May invoke the task agent if heuristics return no candidates (consumes provider tokens).",
      parameters: Type.Object({
        site: Type.String({
          minLength: 3,
          maxLength: 256,
          description: "Website name or URL (e.g. 'coindesk.com' or 'https://www.theblock.co').",
        }),
      }),
      async execute(_id: string, params: unknown) {
        try {
          const p = params as { site: string };
          const candidates = await rssDiscovery.discover(p.site);
          if (candidates.length === 0) {
            return textResult(
              `No RSS feed found for ${p.site}. The site may not publish one; ask the user for a direct feed URL.`,
            );
          }
          const lines = [
            `Found ${candidates.length} candidate feed${candidates.length > 1 ? "s" : ""} for ${p.site}:`,
            "",
          ];
          for (const c of candidates) {
            lines.push(`- ${c.title} — ${c.url}  (via ${c.source})`);
          }
          lines.push("", "Ask the user which one to add (default: first in list), then call ghost_news_add_source with the chosen { name, feed_url }.");
          return textResult(lines.join("\n"));
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    },
    {
      name: "ghost_news_add_source",
      label: "News — Add Custom Source",
      description:
        "Persist a custom RSS / Atom feed as a news source. Only call AFTER ghost_news_discover_rss returned " +
        "candidates AND the user confirmed which one to add. Provide a human-readable name and the feed URL.",
      parameters: Type.Object({
        name: Type.String({ minLength: 1, maxLength: 80, description: "Display name (e.g. 'CoinDesk')." }),
        feed_url: Type.String({ minLength: 7, maxLength: 512, description: "Direct RSS/Atom URL." }),
      }),
      async execute(_id: string, params: unknown) {
        try {
          const p = params as { name: string; feed_url: string };
          const res = news.addCustomRss(p.feed_url, p.name);
          if (!res.ok) return errorResult(res.error ?? "Failed to add source.");
          return textResult(`Added news source "${p.name}". It will be polled in the next news-fetch cycle.`);
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    },
  ];
}
