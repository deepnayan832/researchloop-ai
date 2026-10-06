import test from "node:test";
import assert from "node:assert/strict";
import { runEvaluationCases } from "../server/evaluation/evaluator.js";
import { evaluateQualityGate, normalizeCritique } from "../server/evaluation/critic.js";
import { dedupeEvidence } from "../server/evidence/store.js";
import { deriveCompanyClassification } from "../server/evidence/classification.js";
import { iterationLimitReached, createTargetedRetryInput } from "../server/loop/retry-controller.js";
import type { Analysis, Critique, EvidenceObject, ResearchPlan } from "../server/types.js";
import type { SearchSource } from "../server/types.js";

test("all deterministic evaluation cases pass", () => {
  const results = runEvaluationCases();
  assert.ok(results.length >= 10);
  assert.deepEqual(results.filter((result) => !result.passed), []);
});

test("required unanswered evidence creates a targeted gap and blocks the quality gate", () => {
  const plan: ResearchPlan = {
    objective: "Check the filing.",
    researchQuestions: [{ id: "Q1", question: "Verify the latest exchange filing.", priority: "high", required: true }]
  };
  const critique: Critique = {
    overallScore: 95, completenessScore: 95, evidenceScore: 95, recencyScore: 95,
    citationScore: 95, consistencyScore: 95, criticalErrors: [], unsupportedClaims: [],
    missingQuestions: [], missingData: [], conflictingSources: [], retryRequired: false, retryPriority: []
  };
  const analysis: Analysis = {
    executiveSummary: "No evidence was retrieved.", whatHappened: "Unknown.", fundamentalContext: "Unknown.",
    claims: [], likelyDrivers: [], bullCase: [], bearCase: [], keyRisks: [], contradictions: [], unknowns: [], missingEvidence: []
  };
  const normalized = normalizeCritique(critique, plan, [], analysis);
  assert.equal(normalized.retryRequired, true);
  assert.deepEqual(createTargetedRetryInput(normalized, plan).allowedQuestionIds, ["Q1"]);
  assert.equal(evaluateQualityGate({ plan, evidence: [], critique: normalized, analysis }).passed, false);
});

test("a critic retry flag without an evidence gap does not block finalization", () => {
  const plan: ResearchPlan = {
    objective: "Check a disclosed result.",
    researchQuestions: [{ id: "Q1", question: "Check the disclosed result.", priority: "high", required: true }]
  };
  const evidence: EvidenceObject[] = [{
    id: "ev_1", questionIds: ["Q1"], claim: "The company published its results.", kind: "FACT",
    sourceIds: ["src_1"], sourceType: "secondary", publisher: "news.example", publicationDate: null,
    reportingPeriod: null, evidenceText: "The source says a result was published.", confidence: null,
    freshness: "unknown", supports: ["Q1"], contradicts: [], sourceCount: 1, independentEvidenceCount: 1
  }];
  const critique: Critique = {
    overallScore: 91, completenessScore: 91, evidenceScore: 91, recencyScore: 91,
    citationScore: 91, consistencyScore: 91, criticalErrors: [], unsupportedClaims: [],
    missingQuestions: [], missingData: [], conflictingSources: [], retryRequired: true, retryPriority: []
  };
  const analysis: Analysis = {
    executiveSummary: "A source reports a result.", whatHappened: "A result was reported.", fundamentalContext: "Unknown.",
    claims: [{ id: "C1", text: "The source reports a result.", kind: "FACT", evidenceIds: ["ev_1"] }],
    likelyDrivers: [], bullCase: [], bearCase: [], keyRisks: [], contradictions: [], unknowns: [], missingEvidence: []
  };
  const normalized = normalizeCritique(critique, plan, evidence, analysis);
  assert.equal(normalized.retryRequired, false);
  assert.equal(evaluateQualityGate({ plan, evidence, critique: normalized, analysis }).passed, true);
});

test("duplicate claims merge sources while retaining the count of distinct publishers", () => {
  const base: EvidenceObject = {
    id: "ev_a", questionIds: ["Q1"], claim: "Revenue increased 18 percent year over year.",
    kind: "FACT", sourceIds: ["src_a"], sourceType: "secondary", publisher: "one.example",
    publicationDate: null, reportingPeriod: "FY2026", evidenceText: "Revenue increased.",
    confidence: null, freshness: "unknown", supports: ["Q1"], contradicts: [],
    sourceCount: 1, independentEvidenceCount: 1
  };
  const duplicate = { ...base, id: "ev_b", sourceIds: ["src_b"], publisher: "two.example" };
  const grouped = dedupeEvidence([base, duplicate]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.sourceCount, 2);
  assert.equal(grouped[0]!.independentEvidenceCount, 2);
});

test("research iteration cap cannot be exceeded", () => {
  assert.equal(iterationLimitReached(3), false);
  assert.equal(iterationLimitReached(4), true);
});

test("small-cap classification requires a current explicit fact from a verified primary domain", () => {
  const plan: ResearchPlan = {
    objective: "Verify classification.",
    researchQuestions: [{ id: "Q1", question: "Verify the current small-cap classification.", priority: "high", required: true }]
  };
  const item: EvidenceObject = {
    id: "ev_class", questionIds: ["Q1"], claim: "ABC is currently classified as small-cap.",
    kind: "FACT", sourceIds: ["src_class"], sourceType: "primary", publisher: "nseindia.com",
    publicationDate: new Date().toISOString(), reportingPeriod: null, evidenceText: "Current classification: small-cap.",
    confidence: null, freshness: "current", supports: ["Q1"], contradicts: [],
    sourceCount: 1, independentEvidenceCount: 1
  };
  const source: SearchSource = {
    id: "src_class", url: "https://www.nseindia.com/filings/company-classification", canonicalUrl: "https://www.nseindia.com/filings/company-classification",
    title: "Classification filing", snippet: "Current classification: small-cap.", publisher: "nseindia.com",
    domain: "nseindia.com", provider: "tavily", sourceType: "primary", publicationDate: item.publicationDate,
    retrievedAt: new Date().toISOString(), query: "ABC classification", iteration: 1
  };
  const result = deriveCompanyClassification("Verify ABC Ltd current small-cap classification.", plan, [item], [source]);
  assert.equal(result.classification, "small-cap");
  assert.equal(result.source, source.url);
  assert.equal(result.confidence, null);

  const nonPrimary = deriveCompanyClassification("Verify ABC Ltd current small-cap classification.", plan, [item], [{ ...source, sourceType: "secondary", url: "https://news.example/story" }]);
  assert.equal(nonPrimary.classification, "unknown");
});
