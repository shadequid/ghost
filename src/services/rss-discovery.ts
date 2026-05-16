/**
 * RssDiscoveryService — given a website URL, find its RSS/Atom feed.
 *
 * Two-tier approach:
 *   1. Heuristics — HTML link-sniff + well-known path probe (free, deterministic)
 *   2. LLM fallback — single taskAgent call when heuristics find nothing
 *
 * Fetch timeouts split by purpose: HTML/landing fetches use 8s (richer
 * documents, slow CDNs are common); well-known path probes use 4s (a slow
 * path drags the whole batch — bail faster). Network failures degrade
 * gracefully — the tier is skipped, not thrown.
 */

import type { Logger } from "pino";
import type { Runner } from "../agent/runner.js";
import { parseFeedTitle, parseRssItemCount } from "./news-sources.js";
import { parseLlmJsonObject } from "../helpers/parse-llm-json.js";
import { validateUrlSafety } from "../helpers/url-safety.js";

export interface RssCandidate {
  url: string;
  title: string;
  source: "html-link" | "well-known" | "llm";
}

const WELL_KNOWN_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml"];

const DEFAULT_VALIDATE_TIMEOUT_MS = 8_000;
const WELL_KNOWN_PROBE_TIMEOUT_MS = 4_000;

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; GhostBot/1.0; +https://ghost.trading)",
  "Accept": "application/rss+xml, application/atom+xml, text/xml, application/xml, text/html, */*",
};

const RSS_CT_RE = /xml|rss|atom/i;

export class RssDiscoveryService {
  private readonly log: Logger;

  constructor(private readonly runner: Runner, logger: Logger) {
    this.log = logger;
  }

  async discover(site: string): Promise<RssCandidate[]> {
    let siteUrl: URL;
    try {
      siteUrl = this.resolveSite(site);
    } catch (err) {
      this.log.warn({ site, err }, "rss-discover: invalid site URL");
      return [];
    }

    const heuristicCandidates = await this.heuristicTier(siteUrl);
    if (heuristicCandidates.length > 0) {
      return heuristicCandidates.slice(0, 5);
    }

    this.log.debug({ site }, "rss-discover: heuristics found nothing, trying LLM fallback");
    const llmCandidates = await this.llmFallback(siteUrl);
    return llmCandidates.slice(0, 5);
  }

  private resolveSite(s: string): URL {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const parsed = new URL(withScheme);
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Unsupported scheme: ${parsed.protocol}`);
    }
    return parsed;
  }

  private async heuristicTier(siteUrl: URL): Promise<RssCandidate[]> {
    const [htmlCandidates, wellKnownCandidates] = await Promise.all([
      this.sniffHtmlLink(siteUrl),
      this.probeWellKnownPaths(siteUrl),
    ]);

    const seen = new Set<string>();
    const all: RssCandidate[] = [];

    for (const c of [...htmlCandidates, ...wellKnownCandidates]) {
      const key = normalizeUrl(c.url);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(c);
      }
    }
    return all;
  }

  private async sniffHtmlLink(siteUrl: URL): Promise<RssCandidate[]> {
    try {
      await validateUrlSafety(siteUrl.toString());
    } catch (e: unknown) {
      this.log.debug({ url: siteUrl.toString(), err: (e as Error).message }, "url blocked");
      return [];
    }

    let html: string;
    try {
      // redirect: "manual" prevents SSRF via 3xx to internal addresses — revalidation is impractical after redirect
      const res = await fetch(siteUrl.toString(), {
        signal: AbortSignal.timeout(8_000),
        headers: FETCH_HEADERS,
        redirect: "manual",
      });
      // Treat redirects as failure — we don't re-validate the Location target
      if (res.status >= 300) return [];
      html = await res.text();
    } catch (err) {
      this.log.debug({ url: siteUrl.toString(), err }, "rss-discover: html fetch failed");
      return [];
    }

    // Match <link rel="alternate" type="application/rss+xml" ...> or atom+xml
    const linkRe = /<link[^>]+rel\s*=\s*["']alternate["'][^>]*>/gi;
    const candidates: RssCandidate[] = [];
    let match: RegExpExecArray | null;

    while ((match = linkRe.exec(html)) !== null) {
      const tag = match[0];
      const typeMatch = tag.match(/type\s*=\s*["']([^"']+)["']/i);
      if (!typeMatch) continue;
      const type = typeMatch[1].toLowerCase();
      if (!type.includes("rss") && !type.includes("atom")) continue;

      const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) continue;

      let feedUrl: string;
      try {
        feedUrl = new URL(hrefMatch[1], siteUrl).toString();
      } catch {
        continue;
      }

      const titleMatch = tag.match(/title\s*=\s*["']([^"']+)["']/i);
      const linkTitle = titleMatch ? titleMatch[1] : "";

      const validated = await this.validateFeed(feedUrl);
      if (!validated) continue;

      candidates.push({
        url: feedUrl,
        title: validated.title || linkTitle || siteUrl.hostname,
        source: "html-link",
      });
    }

    return candidates;
  }

  private async probeWellKnownPaths(siteUrl: URL): Promise<RssCandidate[]> {
    const origin = siteUrl.origin;
    const paths = WELL_KNOWN_PATHS.map((p) => `${origin}${p}`);

    // Process in batches of 4 to cap burst concurrency. Well-known probes use
    // a tighter 4s timeout than the default — a single slow path otherwise
    // drags the whole batch to 8s.
    const results: RssCandidate[] = [];
    for (let i = 0; i < paths.length; i += 4) {
      const batch = paths.slice(i, i + 4);
      const settled = await Promise.allSettled(
        batch.map((url) => this.validateFeed(url, WELL_KNOWN_PROBE_TIMEOUT_MS)),
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled" && r.value) {
          results.push({
            url: batch[j],
            title: r.value.title || siteUrl.hostname,
            source: "well-known",
          });
        }
      }
    }
    return results;
  }

  private async validateFeed(
    url: string,
    timeoutMs: number = DEFAULT_VALIDATE_TIMEOUT_MS,
  ): Promise<{ title: string; itemCount: number } | null> {
    try {
      await validateUrlSafety(url);
    } catch (e: unknown) {
      this.log.debug({ url, err: (e as Error).message }, "url blocked");
      return null;
    }

    let text: string;
    try {
      // redirect: "manual" prevents SSRF via 3xx to internal addresses
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: FETCH_HEADERS, redirect: "manual" });
      // Treat redirects as failure — we don't re-validate the Location target
      if (res.status >= 300) return null;
      if (!res.ok) return null;
      const isXmlCt = RSS_CT_RE.test(res.headers.get("content-type") ?? "");
      // Cap read to 16 KB to avoid pulling large feeds into memory
      text = await readCapped(res, 16_384);
      if (!isXmlCt && !text.trimStart().startsWith("<?xml") && !text.includes("<rss") && !text.includes("<feed")) {
        return null;
      }
    } catch (err) {
      this.log.debug({ url, err }, "rss-discover: feed validate fetch failed");
      return null;
    }
    const itemCount = parseRssItemCount(text);
    if (itemCount === 0) return null;
    return { title: parseFeedTitle(text) ?? "", itemCount };
  }

  private async llmFallback(siteUrl: URL): Promise<RssCandidate[]> {
    let raw: string;
    try {
      raw = await this.runner.call({
        systemPrompt: "You are an RSS-feed-URL resolver. Reply with JSON only — no markdown.",
        message: `Find the public RSS or Atom feed URL for the website ${siteUrl.hostname}. Reply with JSON { "url": "<feed url>", "title": "<feed title>" } or {} if none. No markdown.`,
      });
    } catch (err) {
      this.log.warn({ site: siteUrl.hostname, err }, "rss-discover: LLM fallback failed");
      return [];
    }

    const parsed = parseLlmJsonObject(raw);
    if (!parsed || typeof parsed !== "object" || parsed === null) return [];
    const obj = parsed as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!url) return [];

    const validated = await this.validateFeed(url);
    if (!validated) {
      this.log.debug({ url }, "rss-discover: LLM suggestion failed validation");
      return [];
    }

    return [{ url, title: validated.title || title || siteUrl.hostname, source: "llm" }];
  }
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(merged);
}
