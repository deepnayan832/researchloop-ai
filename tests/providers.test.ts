import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleProvider } from "../server/llm/provider.js";
import { TavilyResearchProvider } from "../server/research/tavily.js";
import { classifySource, canonicalizeUrl } from "../server/evidence/store.js";
import type { AppConfig } from "../server/types.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8787, host: "127.0.0.1", databasePath: ":memory:", llmBaseUrl: "https://api.example/v1",
    llmApiKey: "", llmModel: "", tavilyApiKey: "", marketDataProvider: "yahoo",
    marketDataBaseUrl: "https://query1.finance.yahoo.com", marketDataApiKey: "", ...overrides
  };
}

test("missing LLM credentials do not issue a network request", async () => {
  const provider = new OpenAICompatibleProvider(config());
  assert.equal(provider.configured, false);
  await assert.rejects(
    provider.generateText("system", "user"),
    /LLM_API_KEY and LLM_MODEL are required/
  );
});

test("OpenAI-compatible structured output repairs malformed JSON once and tracks both calls", async (t) => {
  let calls = 0;
  const server: Server = createServer(async (request, response) => {
    calls += 1;
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer test-key");
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    assert.equal(JSON.parse(body).response_format.type, "json_object");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: calls === 1 ? "not json" : "{\"value\":\"repaired\"}" } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  t.after(async () => new Promise<void>((resolve) => server.close(() => resolve())));
  const provider = new OpenAICompatibleProvider(config({
    llmBaseUrl: "http://127.0.0.1:" + address.port + "/v1",
    llmApiKey: "test-key",
    llmModel: "fixture-model"
  }));
  const usage: unknown[] = [];
  const result = await provider.generateStructured("system", "schema instructions", "input", (value) => {
    if (!value || typeof value !== "object" || typeof (value as { value?: unknown }).value !== "string") throw new Error("invalid value");
    return value as { value: string };
  }, (name, stats, error) => usage.push({ name, stats, error }));
  assert.deepEqual(result, { value: "repaired" });
  assert.equal(calls, 2);
  assert.equal(usage.length, 2);
});

test("missing Tavily key is reported without a search attempt", async () => {
  const provider = new TavilyResearchProvider(config());
  assert.equal(provider.configured, false);
  await assert.rejects(provider.search("company result", 1), /Tavily is not configured/);
  assert.equal(provider.searchCount, 0);
});

test("provider HTTP 429 is surfaced and counted as an attempted Tavily search", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 429 })) as typeof fetch;
  try {
    const provider = new TavilyResearchProvider(config({ tavilyApiKey: "test-key" }));
    await assert.rejects(provider.search("company filing", 1), /HTTP 429/);
    assert.equal(provider.searchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only recognized authoritative domains are labeled primary", () => {
  assert.equal(classifySource("https://www.nseindia.com/get-quotes/equity"), "primary");
  assert.equal(classifySource("https://sebi.gov.in/filing"), "primary");
  assert.equal(classifySource("https://news.example.com/company"), "secondary");
});

test("canonical source URLs remove known tracking parameters only", () => {
  assert.equal(
    canonicalizeUrl("https://example.com/story?utm_source=search&id=3#section"),
    "https://example.com/story?id=3"
  );
});
