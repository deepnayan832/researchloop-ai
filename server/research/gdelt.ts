import type { SearchSource } from "../types.js";
import { ProviderError } from "../errors.js";
import { canonicalizeUrl, normalizePublicationDate, sourceId } from "../evidence/store.js";

export class GdeltResearchProvider {
  readonly available = true;
  searchCount = 0;

  async search(query: string, iteration: number, timeoutMs = 20000): Promise<SearchSource[]> {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "DateDesc");
    url.searchParams.set("maxrecords", "10");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    this.searchCount += 1;
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new ProviderError("gdelt", "GDELT returned HTTP " + response.status + ".", response.status, response.status === 429 || response.status >= 500);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text) as Record<string, unknown>; }
      catch { throw new ProviderError("gdelt", "GDELT returned malformed JSON."); }
      const articles = Array.isArray(body.articles) ? body.articles : [];
      return articles.slice(0, 10).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const candidateUrl = typeof item.url === "string" ? item.url : "";
        const title = typeof item.title === "string" ? item.title : "";
        if (!candidateUrl || !title) return [];
        let canonical: string;
        let domain: string;
        try {
          canonical = canonicalizeUrl(candidateUrl);
          domain = new URL(canonical).hostname.toLowerCase().replace(/^www\./, "");
        } catch { return []; }
        const rawDate = typeof item.seendate === "string" ? item.seendate : null;
        const parsedDate = rawDate && /^\d{14}$/.test(rawDate)
          ? rawDate.slice(0, 4) + "-" + rawDate.slice(4, 6) + "-" + rawDate.slice(6, 8) + "T" + rawDate.slice(8, 10) + ":" + rawDate.slice(10, 12) + ":" + rawDate.slice(12, 14) + "Z"
          : rawDate;
        const publicationDate = normalizePublicationDate(parsedDate);
        return [{
          id: sourceId(canonical),
          url: candidateUrl,
          canonicalUrl: canonical,
          title: title.slice(0, 400),
          snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 4000) : title,
          publisher: typeof item.domain === "string" ? item.domain : domain,
          domain,
          provider: "gdelt",
          sourceType: "secondary" as const,
          publicationDate,
          retrievedAt: new Date().toISOString(),
          query,
          iteration
        }];
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ProviderError("gdelt", "GDELT request timed out.", null, true);
      throw new ProviderError("gdelt", "GDELT request failed: " + (error instanceof Error ? error.message : "network error"), null, true);
    } finally {
      clearTimeout(timer);
    }
  }
}
