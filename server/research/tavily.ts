import type { AppConfig, SearchSource } from "../types.js";
import { ProviderError } from "../errors.js";
import { classifySource, canonicalizeUrl, normalizePublicationDate, sourceId } from "../evidence/store.js";

export interface SearchResult {
  sources: SearchSource[];
  credits: number | null;
}

export class TavilyResearchProvider {
  readonly configured: boolean;
  searchCount = 0;
  creditEstimate: number | null = 0;

  constructor(private readonly config: AppConfig, private readonly timeoutMs = 25000) {
    this.configured = Boolean(config.tavilyApiKey);
  }

  async search(query: string, iteration: number, timeoutMs = this.timeoutMs): Promise<SearchResult> {
    if (!this.configured) throw new ProviderError("tavily", "Tavily is not configured; no web search was performed.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    this.searchCount += 1;
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          api_key: this.config.tavilyApiKey,
          query,
          search_depth: "advanced",
          topic: "general",
          max_results: 5,
          include_answer: false,
          include_raw_content: false
        }),
        signal: controller.signal
      });
      const text = await response.text();
      let body: Record<string, unknown>;
      try { body = JSON.parse(text) as Record<string, unknown>; }
      catch { throw new ProviderError("tavily", "Tavily returned malformed JSON.", response.status, response.status === 429 || response.status >= 500); }
      if (!response.ok) throw new ProviderError("tavily", "Tavily returned HTTP " + response.status + ".", response.status, response.status === 429 || response.status >= 500);
      const rawResults = Array.isArray(body.results) ? body.results : [];
      const sources = rawResults.slice(0, 5).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        if (typeof item.url !== "string" || typeof item.title !== "string") return [];
        let canonical: string;
        try { canonical = canonicalizeUrl(item.url); } catch { return []; }
        let domain = "";
        try { domain = new URL(canonical).hostname.replace(/^www\./, "").toLowerCase(); } catch { return []; }
        return [{
          id: sourceId(canonical),
          url: item.url,
          canonicalUrl: canonical,
          title: item.title.slice(0, 400),
          snippet: typeof item.content === "string" ? item.content.slice(0, 8000) : "",
          publisher: domain,
          domain,
          provider: "tavily",
          sourceType: classifySource(canonical),
          publicationDate: normalizePublicationDate(item.published_date),
          retrievedAt: new Date().toISOString(),
          query,
          iteration
        }];
      });
      const creditsValue = typeof body.credits === "number"
        ? body.credits
        : body.usage && typeof body.usage === "object" && typeof (body.usage as Record<string, unknown>).credits === "number"
          ? Number((body.usage as Record<string, unknown>).credits)
          : null;
      if (creditsValue !== null) this.creditEstimate = (this.creditEstimate ?? 0) + creditsValue;
      else this.creditEstimate = null;
      return { sources, credits: creditsValue };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ProviderError("tavily", "Tavily request timed out.", null, true);
      throw new ProviderError("tavily", "Tavily request failed: " + (error instanceof Error ? error.message : "network error"), null, true);
    } finally {
      clearTimeout(timer);
    }
  }
}
