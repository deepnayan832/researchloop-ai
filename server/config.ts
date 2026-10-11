import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types.js";

function readEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]!] !== undefined) continue;
    const value = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]!] = value;
  }
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  readEnvFile(path.join(cwd, ".env"));
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  const accessPassword = process.env.APP_ACCESS_PASSWORD || "";
  const publicOriginInput = (process.env.PUBLIC_ORIGIN || "").trim();
  const isProduction = process.env.NODE_ENV === "production";
  let publicOrigin: string | undefined;
  if (publicOriginInput) {
    let parsed: URL;
    try { parsed = new URL(publicOriginInput); }
    catch { throw new Error("PUBLIC_ORIGIN must be an absolute HTTP(S) origin, e.g. https://research.example.com."); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("PUBLIC_ORIGIN must contain only the scheme, hostname, and optional port.");
    }
    publicOrigin = parsed.origin;
  }
  if (isProduction) {
    if (accessPassword.length < 16) {
      throw new Error("Production requires APP_ACCESS_PASSWORD to be set to at least 16 characters.");
    }
    if (!publicOrigin || !publicOrigin.startsWith("https://")) {
      throw new Error("Production requires PUBLIC_ORIGIN to be an HTTPS origin.");
    }
  }
  function positiveInteger(name: string, fallback: number, maximum: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(name + " must be an integer between 1 and " + maximum + ".");
    }
    return value;
  }
  const retentionRaw = process.env.RESEARCH_RETENTION_DAYS;
  const researchRetentionDays = retentionRaw === undefined || retentionRaw.trim() === "" ? 0 : Number(retentionRaw);
  if (!Number.isInteger(researchRetentionDays) || researchRetentionDays < 0 || researchRetentionDays > 3650) {
    throw new Error("RESEARCH_RETENTION_DAYS must be an integer between 0 and 3650 (0 disables automatic deletion).");
  }
  return {
    port,
    host: process.env.HOST || "127.0.0.1",
    databasePath: process.env.DATABASE_PATH || "data/researchloop.sqlite",
    llmBaseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    llmApiKey: process.env.LLM_API_KEY || "",
    llmModel: process.env.LLM_MODEL || "",
    tavilyApiKey: process.env.TAVILY_API_KEY || "",
    marketDataProvider: process.env.MARKET_DATA_PROVIDER || "yahoo",
    marketDataBaseUrl: (process.env.MARKET_DATA_BASE_URL || "https://query1.finance.yahoo.com").replace(/\/+$/, ""),
    marketDataApiKey: process.env.MARKET_DATA_API_KEY || "",
    publicOrigin,
    accessPassword,
    trustProxy: process.env.TRUST_PROXY === "true",
    maxConcurrentResearchRuns: positiveInteger("MAX_CONCURRENT_RESEARCH_RUNS", 3, 100),
    researchRunsPerMinute: positiveInteger("RESEARCH_RUNS_PER_MINUTE", 5, 1000),
    sessionRequestsPerMinute: positiveInteger("SESSION_REQUESTS_PER_MINUTE", 10, 1000),
    researchRetentionDays
  };
}

export function resolveDatabasePath(databasePath: string, cwd = process.cwd()): string {
  if (databasePath === ":memory:") return databasePath;
  return path.isAbsolute(databasePath) ? databasePath : path.resolve(cwd, databasePath);
}
