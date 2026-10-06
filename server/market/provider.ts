import type { AppConfig, Exchange } from "../types.js";
import { ProviderError } from "../errors.js";

export interface MarketQuote {
  symbol: string;
  exchange: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  timestamp: string | null;
  sourceUrl: string;
  provider: string;
}

export type MarketDataResult<T> =
  | { status: "AVAILABLE"; data: T }
  | { status: "DATA_NOT_AVAILABLE"; reason: string };

export interface MarketDataProvider {
  readonly configured: boolean;
  getQuote(symbol: string, exchange: Exchange): Promise<MarketDataResult<MarketQuote>>;
  getHistorical(symbol: string, exchange: Exchange, start: Date, end: Date): Promise<MarketDataResult<unknown>>;
  getVolume(symbol: string, exchange: Exchange): Promise<MarketDataResult<number>>;
  getCompanyProfile(symbol: string, exchange: Exchange): Promise<MarketDataResult<never>>;
  getShareholding(symbol: string, exchange: Exchange): Promise<MarketDataResult<never>>;
}

interface YahooChartResponse {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: { quote?: Array<Record<string, Array<number | null>>> };
    }> | null;
  };
}

export class YahooIndiaMarketDataProvider implements MarketDataProvider {
  readonly configured: boolean;

  constructor(private readonly config: AppConfig, private readonly timeoutMs = 20000) {
    this.configured = Boolean(config.marketDataBaseUrl);
  }

  async getQuote(symbol: string, exchange: Exchange): Promise<MarketDataResult<MarketQuote>> {
    if (!this.configured) return { status: "DATA_NOT_AVAILABLE", reason: "Market data provider is not configured." };
    const ticker = this.toTicker(symbol, exchange);
    const url = new URL("/v8/finance/chart/" + encodeURIComponent(ticker), this.config.marketDataBaseUrl);
    url.searchParams.set("range", "5d");
    url.searchParams.set("interval", "1d");
    url.searchParams.set("events", "div,splits");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "ResearchLoopAI/1.0 (+local research client)",
          ...(this.config.marketDataApiKey ? { "Authorization": "Bearer " + this.config.marketDataApiKey } : {})
        },
        signal: controller.signal
      });
      if (!response.ok) throw new ProviderError("market_data", "Market data provider returned HTTP " + response.status + ".", response.status, response.status === 429 || response.status >= 500);
      const body = await response.json() as YahooChartResponse;
      const chart = body.chart?.result?.[0];
      if (!chart?.meta || body.chart?.error) return { status: "DATA_NOT_AVAILABLE", reason: "No quote was returned for this symbol and exchange." };
      const quote = chart.indicators?.quote?.[0] || {};
      const timestamps = chart.timestamp || [];
      const last = timestamps.length - 1;
      const lastNonNull = (key: string): number | null => {
        const values = quote[key] || [];
        for (let i = Math.min(last, values.length - 1); i >= 0; i -= 1) {
          const value = values[i];
          if (typeof value === "number" && Number.isFinite(value)) return value;
        }
        return null;
      };
      const price = typeof chart.meta.regularMarketPrice === "number" ? chart.meta.regularMarketPrice : lastNonNull("close");
      const rawTimestamp = typeof chart.meta.regularMarketTime === "number" ? chart.meta.regularMarketTime : timestamps[last];
      return { status: "AVAILABLE", data: {
        symbol: ticker.replace(/\.(NS|BO)$/i, ""),
        exchange: exchange === "BSE" ? "BSE" : "NSE",
        name: typeof chart.meta.longName === "string" ? chart.meta.longName : typeof chart.meta.shortName === "string" ? chart.meta.shortName : null,
        price: typeof price === "number" ? price : null,
        currency: typeof chart.meta.currency === "string" ? chart.meta.currency : null,
        previousClose: typeof chart.meta.chartPreviousClose === "number" ? chart.meta.chartPreviousClose : null,
        open: lastNonNull("open"),
        dayHigh: lastNonNull("high"),
        dayLow: lastNonNull("low"),
        volume: lastNonNull("volume"),
        timestamp: typeof rawTimestamp === "number" ? new Date(rawTimestamp * 1000).toISOString() : null,
        sourceUrl: url.toString(),
        provider: "Yahoo Finance chart API"
      } };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ProviderError("market_data", "Market data request timed out.", null, true);
      throw new ProviderError("market_data", "Market data request failed: " + (error instanceof Error ? error.message : "network error"), null, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async getHistorical(symbol: string, exchange: Exchange, start: Date, end: Date): Promise<MarketDataResult<unknown>> {
    const ticker = this.toTicker(symbol, exchange);
    const url = new URL("/v8/finance/chart/" + encodeURIComponent(ticker), this.config.marketDataBaseUrl);
    url.searchParams.set("period1", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("period2", String(Math.floor(end.getTime() / 1000)));
    url.searchParams.set("interval", "1d");
    const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new ProviderError("market_data", "Historical data provider returned HTTP " + response.status + ".", response.status);
    const body = await response.json() as YahooChartResponse;
    const chart = body.chart?.result?.[0];
    if (!chart?.timestamp || !chart.indicators?.quote?.[0]) return { status: "DATA_NOT_AVAILABLE", reason: "Historical market data was not returned." };
    return { status: "AVAILABLE", data: chart.timestamp.map((time, index) => ({
      timestamp: new Date(time * 1000).toISOString(),
      open: chart.indicators!.quote![0]!.open?.[index] ?? null,
      high: chart.indicators!.quote![0]!.high?.[index] ?? null,
      low: chart.indicators!.quote![0]!.low?.[index] ?? null,
      close: chart.indicators!.quote![0]!.close?.[index] ?? null,
      volume: chart.indicators!.quote![0]!.volume?.[index] ?? null
    })) };
  }

  async getVolume(symbol: string, exchange: Exchange): Promise<MarketDataResult<number>> {
    const quote = await this.getQuote(symbol, exchange);
    if (quote.status !== "AVAILABLE") return quote;
    return quote.data.volume === null
      ? { status: "DATA_NOT_AVAILABLE", reason: "The quote response contained no volume value." }
      : { status: "AVAILABLE", data: quote.data.volume };
  }

  async getCompanyProfile(_symbol: string, _exchange: Exchange): Promise<MarketDataResult<never>> {
    return { status: "DATA_NOT_AVAILABLE", reason: "The Yahoo chart adapter does not provide a verified company profile." };
  }

  async getShareholding(_symbol: string, _exchange: Exchange): Promise<MarketDataResult<never>> {
    return { status: "DATA_NOT_AVAILABLE", reason: "The Yahoo chart adapter does not provide shareholding data." };
  }

  private toTicker(symbol: string, exchange: Exchange): string {
    const cleaned = symbol.trim().toUpperCase().replace(/[^A-Z0-9.&-]/g, "");
    if (!/^[A-Z0-9][A-Z0-9.&-]{0,19}$/.test(cleaned)) throw new ProviderError("market_data", "Market symbol format is invalid.");
    if (/\.(NS|BO)$/.test(cleaned)) return cleaned;
    return cleaned + (exchange === "BSE" ? ".BO" : ".NS");
  }
}

export function createMarketProvider(config: AppConfig): MarketDataProvider {
  if (config.marketDataProvider.toLowerCase() === "yahoo") return new YahooIndiaMarketDataProvider(config);
  return new YahooIndiaMarketDataProvider({ ...config, marketDataBaseUrl: "" });
}
