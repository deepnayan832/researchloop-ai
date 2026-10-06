import test from "node:test";
import assert from "node:assert/strict";
import { ResearchStore } from "../server/db/index.js";
import type { EvidenceObject, ResearchPlan, SearchSource } from "../server/types.js";

test("SQLite persists runs, plan, sources, evidence, iterations, and watchlist", () => {
  const store = new ResearchStore(":memory:");
  try {
    const run = store.createRun("Verify a recent company announcement and market move.", "NSE");
    const plan: ResearchPlan = {
      objective: "Verify a company announcement.",
      researchQuestions: [{ id: "Q1", question: "Verify the announcement.", priority: "high", required: true }]
    };
    store.savePlan(run.id, plan);
    const first: SearchSource = {
      id: "src_a", url: "https://exchange.example/filing?a=1", canonicalUrl: "https://exchange.example/filing?a=1",
      title: "Official filing", snippet: "The company published a filing.", publisher: "exchange.example",
      domain: "exchange.example", provider: "tavily", sourceType: "primary", publicationDate: null,
      retrievedAt: new Date().toISOString(), query: "company announcement", iteration: 1
    };
    const second: SearchSource = {
      ...first, id: "src_b", url: "https://news.example/story", canonicalUrl: "https://news.example/story",
      title: "News report", publisher: "news.example", domain: "news.example", sourceType: "secondary"
    };
    store.addSources(run.id, [first, second]);
    const item: EvidenceObject = {
      id: "ev_a", questionIds: ["Q1"], claim: "The company published a filing.", kind: "FACT",
      sourceIds: ["src_a"], sourceType: "primary", publisher: "exchange.example", publicationDate: null,
      reportingPeriod: null, evidenceText: "The company published a filing.", confidence: null,
      freshness: "unknown", supports: ["Q1"], contradicts: [], sourceCount: 1, independentEvidenceCount: 1
    };
    store.addEvidence(run.id, [item, {
      ...item, id: "ev_b", sourceIds: ["src_b"], sourceType: "secondary", publisher: "news.example"
    }]);
    store.addWatchlist("ABC", "NSE / BSE");
    const saved = store.getRun(run.id)!;
    assert.equal(saved.plan?.researchQuestions.length, 1);
    assert.equal(saved.sources.length, 2);
    assert.equal(saved.evidence.length, 1);
    assert.equal(saved.evidence[0]!.sourceCount, 2);
    assert.equal(saved.evidence[0]!.sourceType, "primary");
    assert.equal(store.getWatchlist()[0]!.symbol, "ABC");
    store.patchRun(run.id, { status: "completed", stage: "finalize", sourcesChecked: 2 });
    assert.equal(store.getRun(run.id)!.status, "completed");
    assert.equal(store.health(), true);
  } finally {
    store.close();
  }
});

test("duplicate source URLs are ignored", () => {
  const store = new ResearchStore(":memory:");
  try {
    const run = store.createRun("Check a published disclosure.", "BSE");
    const source: SearchSource = {
      id: "src_a", url: "https://example.com/story?utm_source=search", canonicalUrl: "https://example.com/story",
      title: "Story", snippet: "A short description.", publisher: "example.com", domain: "example.com",
      provider: "tavily", sourceType: "secondary", publicationDate: null, retrievedAt: new Date().toISOString(),
      query: "disclosure", iteration: 1
    };
    assert.equal(store.addSources(run.id, [source, { ...source, id: "src_other" }]).length, 1);
    assert.equal(store.getRun(run.id)!.sources.length, 1);
  } finally {
    store.close();
  }
});
