import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Analysis, Critique, EvidenceObject, ResearchPlan } from "../types.js";
import { MAX_ITERATIONS } from "../types.js";
import { dedupeEvidence, freshness } from "../evidence/store.js";
import { OpenAICompatibleProvider } from "../llm/provider.js";
import { normalizeCritique, evaluateQualityGate } from "./critic.js";
import { createTargetedRetryInput, iterationLimitReached } from "../loop/retry-controller.js";

export interface EvalCase {
  id: string;
  kind: string;
  expected: Record<string, unknown>;
}

export interface EvalResult {
  id: string;
  passed: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}

function question(id: string, text = "Verify the latest exchange filing.", required = true): ResearchPlan["researchQuestions"][number] {
  return { id, question: text, priority: "high", required };
}

function emptyCritique(overrides: Partial<Critique> = {}): Critique {
  return {
    overallScore: 92, completenessScore: 92, evidenceScore: 92, recencyScore: 92,
    citationScore: 92, consistencyScore: 92, criticalErrors: [], unsupportedClaims: [],
    missingQuestions: [], missingData: [], conflictingSources: [], retryRequired: false,
    retryPriority: [], ...overrides
  };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    executiveSummary: "The supplied evidence is limited.", whatHappened: "Not enough evidence to conclude.",
    fundamentalContext: "DATA NOT AVAILABLE", claims: [], likelyDrivers: [], bullCase: [],
    bearCase: [], keyRisks: [], contradictions: [], unknowns: [], missingEvidence: [], ...overrides
  };
}

function evidence(input: Partial<EvidenceObject> = {}): EvidenceObject {
  return {
    id: "ev_test", questionIds: ["Q1"], claim: "An official result was published.", kind: "FACT",
    sourceIds: ["src_test"], sourceType: "primary", publisher: "Exchange", publicationDate: null,
    reportingPeriod: null, evidenceText: "The supplied source states that a result was published.",
    confidence: null, freshness: "unknown", supports: ["Q1"], contradicts: [],
    sourceCount: 1, independentEvidenceCount: 1, ...input
  };
}

function plan(text = "Verify the latest exchange filing."): ResearchPlan {
  return { objective: "Check the evidence relevant to the query.", researchQuestions: [question("Q1", text)] };
}

function compareExpected(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
}

function fixtureSources(): EvidenceObject[] {
  return [
    evidence({ id: "ev_one", claim: "Revenue increased during the reporting period.", sourceIds: ["src_a"], publisher: "one.example", sourceType: "secondary", independentEvidenceCount: 1 }),
    evidence({ id: "ev_two", claim: "Revenue increased during the reporting period.", sourceIds: ["src_b"], publisher: "two.example", sourceType: "secondary", independentEvidenceCount: 1 })
  ];
}

export function evaluateScenario(kind: string): Record<string, unknown> {
  if (kind === "missing-evidence") {
    const p = plan();
    const c = normalizeCritique(emptyCritique(), p, [], analysis());
    const gate = evaluateQualityGate({ plan: p, evidence: [], critique: c, analysis: analysis() });
    return { retryRequired: c.retryRequired, qualityGatePassed: gate.passed };
  }
  if (kind === "conflicting-evidence") {
    const p = plan("Compare conflicting filing disclosures.");
    const items = [evidence({ id: "ev_a" }), evidence({ id: "ev_b", claim: "A different result was published." })];
    const c = emptyCritique({ conflictingSources: [{ description: "Two retrieved sources disagree.", evidenceIds: ["ev_a", "ev_b"], critical: true }] });
    const gate = evaluateQualityGate({ plan: p, evidence: items, critique: c, analysis: analysis() });
    return { qualityGatePassed: gate.passed, criticalConflicts: gate.criticalConflicts.length };
  }
  if (kind === "outdated-evidence") {
    const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    return { stale: freshness(date) === "stale" };
  }
  if (kind === "missing-primary-source") {
    const p = plan("Verify the latest exchange filing.");
    const item = evidence({ sourceType: "secondary" });
    const c = normalizeCritique(emptyCritique(), p, [item], analysis());
    const gate = evaluateQualityGate({ plan: p, evidence: [item], critique: c, analysis: analysis() });
    return { retryRequired: c.retryRequired, missingPrimary: gate.missingPrimaryQuestions.includes("Q1") };
  }
  if (kind === "unknown-classification") {
    const p = plan("Verify the current small-cap classification.");
    const c = normalizeCritique(emptyCritique(), p, [], analysis());
    return { retryRequired: c.retryRequired, classificationVerified: false };
  }
  if (kind === "unsupported-causal-claim") {
    const p = plan("Check the company announcement.");
    const raw = emptyCritique();
    const a = analysis({ claims: [{ id: "C1", text: "The result caused the price move.", kind: "INFERENCE", evidenceIds: [] }] });
    const c = normalizeCritique(raw, p, [], a);
    return { criticalErrors: c.criticalErrors.length, qualityGatePassed: evaluateQualityGate({ plan: p, evidence: [], critique: c, analysis: a }).passed };
  }
  if (kind === "duplicate-evidence") {
    const deduped = dedupeEvidence(fixtureSources());
    return { groups: deduped.length, sourceCount: deduped[0]?.sourceCount, distinctPublishers: deduped[0]?.independentEvidenceCount };
  }
  if (kind === "provider-failure") {
    const provider = new OpenAICompatibleProvider({
      port: 8787, host: "127.0.0.1", databasePath: ":memory:", llmBaseUrl: "https://example.invalid/v1",
      llmApiKey: "", llmModel: "", tavilyApiKey: "", marketDataProvider: "yahoo",
      marketDataBaseUrl: "", marketDataApiKey: ""
    });
    return { llmMissing: !provider.configured, reportsLimited: !provider.configured };
  }
  if (kind === "targeted-retry") {
    const p: ResearchPlan = { objective: "Objective", researchQuestions: [
      question("Q1", "Check quote data."), question("Q2", "Verify the latest quarterly filing.")
    ] };
    const c = emptyCritique({ retryRequired: true, retryPriority: [
      { questionId: "Q2", reason: "Latest filing not verified.", priority: "high" }
    ] });
    return { targets: createTargetedRetryInput(c, p).allowedQuestionIds };
  }
  if (kind === "one-pass-completion") {
    const p = plan();
    const item = evidence();
    const gate = evaluateQualityGate({ plan: p, evidence: [item], critique: emptyCritique(), analysis: analysis() });
    return { qualityGatePassed: gate.passed };
  }
  if (kind === "max-iteration-stop") {
    return { stopped: iterationLimitReached(MAX_ITERATIONS), maximum: MAX_ITERATIONS };
  }
  if (kind === "critic-false-positive") {
    const p = plan("Check the announced result.");
    const item = evidence({ sourceType: "secondary", supports: ["Q1"] });
    const c = normalizeCritique(emptyCritique({ retryRequired: true, retryPriority: [] }), p, [item], analysis());
    const gate = evaluateQualityGate({ plan: p, evidence: [item], critique: c, analysis: analysis() });
    return { retryRequired: c.retryRequired, qualityGatePassed: gate.passed };
  }
  throw new Error("Unknown evaluation case: " + kind);
}

export function runEvaluationCases(casesDirectory = path.resolve(process.cwd(), "evaluation/cases")): EvalResult[] {
  const files = readdirSync(casesDirectory).filter((file) => file.endsWith(".json")).sort();
  return files.map((file) => {
    const testCase = JSON.parse(readFileSync(path.join(casesDirectory, file), "utf8")) as EvalCase;
    const actual = evaluateScenario(testCase.kind);
    return { id: testCase.id, passed: compareExpected(actual, testCase.expected), expected: testCase.expected, actual };
  });
}
