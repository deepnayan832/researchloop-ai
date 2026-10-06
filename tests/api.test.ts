import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ResearchStore } from "../server/db/index.js";
import { createResearchServer } from "../server/http.js";
import { ResearchOrchestrator } from "../server/loop/orchestrator.js";
import type { AppConfig } from "../server/types.js";

const appConfig: AppConfig = {
  port: 0, host: "127.0.0.1", databasePath: ":memory:", llmBaseUrl: "https://api.example/v1",
  llmApiKey: "", llmModel: "", tavilyApiKey: "", marketDataProvider: "yahoo",
  marketDataBaseUrl: "", marketDataApiKey: ""
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return "http://127.0.0.1:" + address.port;
}

test("API session auth, request validation, SSE replay, persistence, watchlist, and export", async (t) => {
  const store = new ResearchStore(":memory:");
  const orchestrator = new ResearchOrchestrator(store, appConfig);
  const server = createResearchServer({ config: appConfig, store, orchestrator });
  const base = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  const unauthenticated = await fetch(base + "/api/research/runs");
  assert.equal(unauthenticated.status, 401);

  const session = await fetch(base + "/api/session");
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("researchloop_session="));
  assert.match(session.headers.get("set-cookie") || "", /HttpOnly/);
  assert.match(session.headers.get("set-cookie") || "", /SameSite=Strict/);

  const invalid = await fetch(base + "/api/research/run", {
    method: "POST", headers: { Cookie: cookie!, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "short", exchange: "NSE" })
  });
  assert.equal(invalid.status, 400);

  const crossOrigin = await fetch(base + "/api/watchlist", {
    method: "POST", headers: { Cookie: cookie!, Origin: "http://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "ABC" })
  });
  assert.equal(crossOrigin.status, 403);

  const added = await fetch(base + "/api/watchlist", {
    method: "POST", headers: { Cookie: cookie!, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "ABC", exchange: "NSE" })
  });
  assert.equal(added.status, 201);
  assert.equal((await (await fetch(base + "/api/watchlist", { headers: { Cookie: cookie! } })).json() as { items: unknown[] }).items.length, 1);

  const created = await fetch(base + "/api/research/run", {
    method: "POST", headers: { Cookie: cookie!, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Why did ABC Ltd rise sharply today?", exchange: "NSE" })
  });
  assert.equal(created.status, 202);
  const createdBody = await created.json() as { run_id: string };
  const detailResponse = await fetch(base + "/api/research/runs/" + createdBody.run_id, { headers: { Cookie: cookie! } });
  const detail = await detailResponse.json() as { run: { status: string; iterationCount: number; sourcesChecked: number; report: { status: string } } };
  assert.equal(detail.run.status, "limited");
  assert.equal(detail.run.iterationCount, 0);
  assert.equal(detail.run.sourcesChecked, 0);
  assert.equal(detail.run.report.status, "LIMITED");

  const eventResponse = await fetch(base + "/api/research/runs/" + createdBody.run_id + "/events", {
    headers: { Cookie: cookie!, Accept: "text/event-stream" }
  });
  const eventText = await eventResponse.text();
  assert.match(eventText, /"type":"final"/);
  assert.match(eventText, /"status":"limited"/);

  const exportResponse = await fetch(base + "/api/research/runs/" + createdBody.run_id + "/export", { headers: { Cookie: cookie! } });
  const exported = await exportResponse.json() as { run_id: string; final_report: { status: string }; sources: unknown[] };
  assert.equal(exported.run_id, createdBody.run_id);
  assert.equal(exported.final_report.status, "LIMITED");
  assert.deepEqual(exported.sources, []);

  const deleted = await fetch(base + "/api/watchlist/ABC", {
    method: "DELETE", headers: { Cookie: cookie!, Origin: base }
  });
  assert.equal(deleted.status, 200);
  assert.equal((await (await fetch(base + "/api/watchlist", { headers: { Cookie: cookie! } })).json() as { items: unknown[] }).items.length, 0);
});

test("health endpoints are available without browser session credentials", async (t) => {
  const store = new ResearchStore(":memory:");
  const server = createResearchServer({ config: appConfig, store, orchestrator: new ResearchOrchestrator(store, appConfig) });
  const base = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { database: string }).database, "healthy");
  const providers = await fetch(base + "/api/providers/health");
  assert.equal(providers.status, 200);
  const result = await providers.json() as { llm: string; tavily: string; gdelt: string; market_data: string; database: string; database_detail: string };
  assert.equal(result.llm, "missing");
  assert.equal(result.tavily, "missing");
  assert.equal(result.gdelt, "available");
  assert.equal(result.market_data, "missing");
  assert.equal(result.database, "healthy");
  assert.equal(result.database_detail, "The local SQLite database is connected.");
});
