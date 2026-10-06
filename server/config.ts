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
    marketDataApiKey: process.env.MARKET_DATA_API_KEY || ""
  };
}

export function resolveDatabasePath(databasePath: string, cwd = process.cwd()): string {
  if (databasePath === ":memory:") return databasePath;
  return path.isAbsolute(databasePath) ? databasePath : path.resolve(cwd, databasePath);
}
