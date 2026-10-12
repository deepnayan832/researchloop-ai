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

  const missingOrigin = await fetch(base + "/api/watchlist", {
    method: "POST", headers: { Cookie: cookie!, "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "NO_ORIGIN" })
  });
  assert.equal(missingOrigin.status, 403);

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


test("production access gate, trusted public origin, secure cookie, and headers", async (t) => {
  const store = new ResearchStore(":memory:");
  const protectedConfig: AppConfig = {
    ...appConfig,
    accessPassword: "unit-test-password-long-enough",
    publicOrigin: "https://research.example.test"
  };
  const server = createResearchServer({
    config: protectedConfig,
    store,
    orchestrator: new ResearchOrchestrator(store, protectedConfig)
  });
  const base = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  // Platform health probes stay public, while other endpoints require the shared password.
  const publicHealth = await fetch(base + "/api/health");
  assert.equal(publicHealth.status, 200);

  const blocked = await fetch(base + "/api/providers/health");
  assert.equal(blocked.status, 401);
  assert.match(blocked.headers.get("www-authenticate") || "", /Basic/);

  const authorization = "Basic " + Buffer.from("researchloop:unit-test-password-long-enough").toString("base64");
  const health = await fetch(base + "/api/providers/health", { headers: { Authorization: authorization } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(health.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(health.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(health.headers.get("cross-origin-resource-policy"), "same-origin");

  const session = await fetch(base + "/api/session", { headers: { Authorization: authorization } });
  assert.equal(session.status, 200);
  assert.match(session.headers.get("set-cookie") || "", /; Secure(?:;|$)/);

  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  const accepted = await fetch(base + "/api/watchlist", {
    method: "POST",
    headers: {
      Authorization: authorization,
      Cookie: cookie!,
      Origin: "https://research.example.test",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ symbol: "HTTPSOK", exchange: "NSE" })
  });
  assert.equal(accepted.status, 201);
});

test("per-IP session and research sliding-window limits return 429", async (t) => {
  const store = new ResearchStore(":memory:");
  const rateConfig: AppConfig = {
    ...appConfig,
    sessionRequestsPerMinute: 10,
    researchRunsPerMinute: 5,
    maxConcurrentResearchRuns: 10
  };
  const server = createResearchServer({
    config: rateConfig,
    store,
    orchestrator: new ResearchOrchestrator(store, rateConfig)
  });
  const base = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  const session = await fetch(base + "/api/session");
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  for (let i = 0; i < 5; i += 1) {
    const researchResponse: Response = await fetch(base + "/api/research/run", {
      method: "POST",
      headers: { Cookie: cookie!, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Rate-limit test request number " + i, exchange: "NSE" })
    });
    assert.equal(researchResponse.status, 202);
  }
  const limitedResearch = await fetch(base + "/api/research/run", {
    method: "POST",
    headers: { Cookie: cookie!, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "The sixth rate-limit test request", exchange: "NSE" })
  });
  assert.equal(limitedResearch.status, 429);
  assert.equal(limitedResearch.headers.get("retry-after"), "60");

  for (let i = 0; i < 9; i += 1) {
    assert.equal((await fetch(base + "/api/session")).status, 200);
  }
  const limitedSession = await fetch(base + "/api/session");
  assert.equal(limitedSession.status, 429);
  assert.equal(limitedSession.headers.get("retry-after"), "60");
});


test("production Basic Auth throttles repeated failures without blocking a valid password", async (t) => {
  const store = new ResearchStore(":memory:");
  const protectedConfig: AppConfig = {
    ...appConfig,
    accessPassword: "unit-test-password-long-enough",
    publicOrigin: "https://research.example.test"
  };
  const server = createResearchServer({
    config: protectedConfig,
    store,
    orchestrator: new ResearchOrchestrator(store, protectedConfig)
  });
  const base = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  const invalidAuthorization = "Basic " + Buffer.from("researchloop:wrong-password").toString("base64");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(base + "/api/providers/health", {
      headers: { Authorization: invalidAuthorization }
    });
    assert.equal(response.status, 401);
  }

  const limited = await fetch(base + "/api/providers/health", {
    headers: { Authorization: invalidAuthorization }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");

  const validAuthorization = "Basic " + Buffer.from("researchloop:unit-test-password-long-enough").toString("base64");
  const valid = await fetch(base + "/api/providers/health", {
    headers: { Authorization: validAuthorization }
  });
  assert.equal(valid.status, 200);
});
