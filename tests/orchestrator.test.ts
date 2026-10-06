import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ResearchStore } from "../server/db/index.js";
import { classifySource, canonicalizeUrl, sourceId } from "../server/evidence/store.js";
import { OpenAICompatibleProvider, type LLMProvider, type Validator } from "../server/llm/provider.js";
import { ResearchOrchestrator } from "../server/loop/orchestrator.js";
import type { AppConfig, Exchange, SearchSource, UsageCallback } from "../server/types.js";
import type { SearchResult } from "../server/research/tavily.js";

type Mode = "one-pass" | "retry" | "max";

const config: AppConfig = {
  port: 8787,
  host: "127.0.0.1",
  databasePath: ":memory:",
  llmBaseUrl: "https://api.example.invalid/v1",
  llmApiKey: "test-only",
  llmModel: "test-only",
  tavilyApiKey: "test-only",
  marketDataProvider: "yahoo",
  marketDataBaseUrl: "",
  marketDataApiKey: ""
};

function buildSource(title: string, suffix: string, query: string, iteration: number): SearchSource {
  const url = canonicalizeUrl("https://www.nseindia.com/researchloop-test/" + suffix);
  return {
    id: sourceId(url),
    url,
    canonicalUrl: url,
    title,
    snippet: title + " was retrieved from the exchange website.",
    publisher: "NSE",
    domain: "nseindia.com",
    provider: "tavily",
    sourceType: classifySource(url),
    publicationDate: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    query,
    iteration
  };
}

class ScriptedLLM implements LLMProvider {
  readonly configured = true;
  readonly promptCalls: string[] = [];
  private critiqueCount = 0;
  constructor(private readonly mode: Mode) {}

  async generateText(): Promise<string> {
    throw new Error("Text generation is not used by this structured workflow.");
  }

  async generateStructured<T>(
    _system: string,
    prompt: string,
    user: string,
    validate: Validator<T>,
    onUsage?: UsageCallback
  ): Promise<T> {
    this.promptCalls.push(prompt);
    const input = JSON.parse(user) as Record<string, unknown>;
    let output: unknown;
    if (prompt.includes("Create an atomic research plan")) {
      output = {
        objective: "Verify the announcement, filing, sector context, and counter-evidence.",
        research_questions: [
          { id: "Q1", question: "Verify the company announcement.", priority: "high", required: true },
          { id: "Q2", question: "Verify the latest quarterly exchange filing.", priority: "high", required: true },
          { id: "Q3", question: "Check relevant sector context.", priority: "medium", required: false },
          { id: "Q4", question: "Check evidence against the proposed explanation.", priority: "medium", required: false }
        ]
      };
    } else if (prompt.includes("Turn the supplied plan questions")) {
      output = { tasks: [{ question_ids: ["Q1"], query: "ABC company disclosures", provider: "tavily" }] };
    } else if (prompt.includes("Create targeted retry tasks only")) {
      output = { tasks: [{ question_ids: ["Q2"], query: "ABC latest quarterly filing", provider: "tavily" }] };
    } else if (prompt.includes("Extract only material claims")) {
      const sources = input.sources as Array<{ id: string; title: string }>;
      const evidence: Array<Record<string, unknown>> = [];
      for (const source of sources) {
        if (source.title.includes("Announcement")) evidence.push({
          question_ids: ["Q1"], claim: "ABC published a company announcement.", kind: "FACT",
          source_ids: [source.id], evidence_text: "The retrieved exchange source lists an ABC announcement.",
          reporting_period: null, supports: ["Q1"], contradicts: []
        });
        if (source.title.includes("Quarterly filing") && this.mode !== "max") evidence.push({
          question_ids: ["Q2"], claim: "ABC published its quarterly filing.", kind: "FACT",
          source_ids: [source.id], evidence_text: "The retrieved exchange source lists the quarterly filing.",
          reporting_period: "FY2026 Q2", supports: ["Q2"], contradicts: []
        });
      }
      output = { evidence };
    } else if (prompt.includes("Analyze the supplied plan and evidence")) {
      const items = input.evidence as Array<{ id: string; claim: string }>;
      output = {
        executive_summary: "The supplied exchange sources report the retrieved disclosures.",
        what_happened: "The retrieved sources list the disclosures.",
        fundamental_context: "Financial context is not available in this fixture.",
        claims: items.map((item, index) => ({
          id: "C" + (index + 1), text: item.claim, kind: "FACT", evidence_ids: [item.id]
        })),
        likely_drivers: [], bull_case: [], bear_case: [], key_risks: [],
        contradictions: [], unknowns: [], missing_evidence: []
      };
    } else if (prompt.includes("Act as an adversarial evaluator")) {
      this.critiqueCount += 1;
      const needsRetry = this.mode === "max" || (this.mode === "retry" && this.critiqueCount === 1);
      const score = this.mode === "one-pass" ? 93 : needsRetry ? 62 : 91;
      output = {
        overall_score: score,
        completeness_score: score,
        evidence_score: score,
        recency_score: score,
        citation_score: score,
        consistency_score: score,
        critical_errors: [],
        unsupported_claims: [],
        missing_questions: needsRetry ? ["Q2"] : [],
        missing_data: needsRetry ? ["Latest quarterly filing"] : [],
        conflicting_sources: [],
        retry_required: needsRetry,
        retry_priority: needsRetry ? [{ question_id: "Q2", reason: "Latest quarterly filing is not verified.", priority: "high" }] : []
      };
    } else if (prompt.includes("Create the final evidence-grounded report")) {
      const items = input.evidence as Array<{ id: string; claim: string }>;
      const ids = items.map((item) => item.id);
      output = {
        status: "COMPLETED",
        executive_summary: { text: "Exchange sources verified the listed disclosures.", evidence_ids: ids.slice(0, 1) },
        what_happened: items.map((item) => ({ text: item.claim, evidence_ids: [item.id] })),
        verified_evidence: ids,
        likely_drivers: [], fundamental_context: [], bull_case: [], bear_case: [],
        key_risks: [], contradictory_evidence: [], unknowns: [],
        confidence: "NOT SCORED", quality_score: 91, limitations: []
      };
    } else {
      throw new Error("Unexpected prompt in integration test.");
    }
    onUsage?.("llm", { totalTokens: 10 });
    return validate(output);
  }
}

class ScriptedTavily {
  readonly configured = true;
  readonly calls: string[] = [];
  constructor(private readonly mode: Mode) {}

  async search(query: string, iteration: number): Promise<SearchResult> {
    this.calls.push(query);
    if (query === "ABC company disclosures") {
      const sources = [buildSource("Announcement filing", "announcement", query, iteration)];
      if (this.mode === "one-pass") sources.push(buildSource("Quarterly filing", "quarterly-filing", query, iteration));
      return { sources, credits: null };
    }
    if (query === "ABC latest quarterly filing") {
      return { sources: [buildSource("Quarterly filing", "quarterly-filing-" + iteration, query, iteration)], credits: null };
    }
    return { sources: [], credits: null };
  }
}

class ScriptedGdelt {
  readonly available = true;
  calls = 0;
  async search(): Promise<SearchSource[]> {
    this.calls += 1;
    return [];
  }
}

async function runScenario(mode: Mode) {
  const store = new ResearchStore(":memory:");
  const llm = new ScriptedLLM(mode);
  const tavily = new ScriptedTavily(mode);
  const gdelt = new ScriptedGdelt();
  const orchestrator = new ResearchOrchestrator(store, config, { llm, tavily, gdelt });
  const run = store.createRun("Review ABC Ltd announcements, quarterly filings, and price movement.", "NSE");
  await orchestrator.execute(run.id);
  return { store, runId: run.id, llm, tavily, gdelt };
}

test("orchestrator completes a one-pass run and calls the finalizer after the quality gate", async () => {
  const result = await runScenario("one-pass");
  try {
    const run = result.store.getRun(result.runId)!;
    assert.equal(run.status, "completed");
    assert.equal(run.iterationCount, 1);
    assert.equal(run.report?.status, "COMPLETED");
    assert.equal(run.report?.qualityScore, 93);
    assert.equal(run.sourcesChecked, 2);
    assert.ok(result.llm.promptCalls.some((prompt) => prompt.includes("Create the final evidence-grounded report")));
    assert.equal(result.gdelt.calls, 1);
  } finally {
    result.store.close();
  }
});

test("orchestrator retries only a critic-identified filing gap", async () => {
  const result = await runScenario("retry");
  try {
    const run = result.store.getRun(result.runId)!;
    assert.equal(run.status, "completed");
    assert.equal(run.iterationCount, 2);
    assert.deepEqual(result.tavily.calls, ["ABC company disclosures", "ABC latest quarterly filing"]);
    assert.equal(run.iterations[0]!.retryRequired, true);
    assert.equal(run.iterations[1]!.retryRequired, false);
    assert.equal(run.evidence.some((item) => item.questionIds.includes("Q2")), true);
  } finally {
    result.store.close();
  }
});

test("orchestrator stops at four iterations when a critical gap never closes", async () => {
  const result = await runScenario("max");
  try {
    const run = result.store.getRun(result.runId)!;
    assert.equal(run.status, "limited");
    assert.equal(run.iterationCount, 4);
    assert.equal(run.iterations.length, 4);
    assert.equal(result.tavily.calls.length, 4);
    assert.equal(result.llm.promptCalls.some((prompt) => prompt.includes("Create the final evidence-grounded report")), false);
    assert.equal(run.report?.status, "LIMITED");
  } finally {
    result.store.close();
  }
});
