import type {
  Analysis, AnalysisClaim, Critique, FinalClaim, FinalReport, Priority, ResearchPlan,
  ResearchQuestion, SearchTask
} from "../types.js";
import { MAX_INITIAL_SEARCHES, MAX_RETRY_TASKS } from "../types.js";
import { SchemaValidationError } from "../errors.js";
import {
  requireArray, requireJsonObject, requireScore, requireString, requireStringArray
} from "../llm/provider.js";

function priority(value: unknown): Priority {
  if (value !== "high" && value !== "medium" && value !== "low") throw new SchemaValidationError("Priority must be high, medium, or low.");
  return value;
}

function parseQuestion(value: unknown, index: number): ResearchQuestion {
  const row = requireJsonObject(value, "research question " + index);
  if (typeof row.required !== "boolean") throw new SchemaValidationError("Research question required must be boolean.");
  return {
    id: requireString(row.id, "question id", 2, 12),
    question: requireString(row.question, "question", 8, 600),
    priority: priority(row.priority),
    required: row.required
  };
}

export function validatePlan(value: unknown): ResearchPlan {
  const root = requireJsonObject(value, "planner response");
  const rawQuestions = requireArray(root.research_questions, "research_questions", 10);
  if (rawQuestions.length < 4) throw new SchemaValidationError("Planner must return at least four atomic research questions.");
  const researchQuestions = rawQuestions.map(parseQuestion);
  const ids = new Set(researchQuestions.map((question) => question.id));
  if (ids.size !== researchQuestions.length || researchQuestions.some((question) => !/^Q[1-9][0-9]?$/.test(question.id))) {
    throw new SchemaValidationError("Research question IDs must be unique IDs such as Q1.");
  }
  return {
    objective: requireString(root.objective, "objective", 8, 1000),
    researchQuestions
  };
}

export function validateSearchTasks(value: unknown, allowedQuestionIds: string[], retry = false): SearchTask[] {
  const root = requireJsonObject(value, "researcher response");
  const max = retry ? MAX_RETRY_TASKS : MAX_INITIAL_SEARCHES;
  const rawTasks = requireArray(root.tasks, "tasks", max);
  if (!retry && rawTasks.length === 0) throw new SchemaValidationError("Initial research needs at least one search task.");
  const allowed = new Set(allowedQuestionIds);
  return rawTasks.map((rawTask, index) => {
    const task = requireJsonObject(rawTask, "search task " + index);
    const questionIds = [...new Set(requireStringArray(task.question_ids, "question_ids", 10))];
    if (!questionIds.length || questionIds.some((id) => !allowed.has(id))) {
      throw new SchemaValidationError("Search tasks may only reference supplied plan question IDs.");
    }
    const provider = task.provider;
    if (provider !== "tavily" && provider !== "gdelt" && provider !== "both") {
      throw new SchemaValidationError("Search task provider must be tavily, gdelt, or both.");
    }
    return {
      questionIds,
      query: requireString(task.query, "search query", 4, 500),
      provider
    };
  });
}

function parseClaim(value: unknown, label: string, evidenceIds: Set<string>): AnalysisClaim {
  const row = requireJsonObject(value, label);
  const kind = row.kind;
  if (!["FACT", "INFERENCE", "ASSUMPTION", "UNKNOWN"].includes(String(kind))) {
    throw new SchemaValidationError(label + " kind is invalid.");
  }
  const cited = [...new Set(requireStringArray(row.evidence_ids, label + " evidence_ids", 20))];
  if (cited.some((id) => !evidenceIds.has(id))) throw new SchemaValidationError(label + " cites evidence that was not collected.");
  return {
    id: requireString(row.id, label + " id", 1, 40),
    text: requireString(row.text, label + " text", 3, 1400),
    kind: kind as AnalysisClaim["kind"],
    evidenceIds: cited
  };
}

export function validateAnalysis(value: unknown, evidenceIds: string[]): Analysis {
  const root = requireJsonObject(value, "analyst response");
  const allowed = new Set(evidenceIds);
  const claims = (key: string, max: number): AnalysisClaim[] =>
    requireArray(root[key], key, max).map((claim, index) => parseClaim(claim, key + " item " + index, allowed));
  return {
    executiveSummary: requireString(root.executive_summary, "executive_summary", 5, 2400),
    whatHappened: requireString(root.what_happened, "what_happened", 3, 1800),
    fundamentalContext: requireString(root.fundamental_context, "fundamental_context", 3, 1800),
    claims: claims("claims", 40),
    likelyDrivers: claims("likely_drivers", 12),
    bullCase: claims("bull_case", 12),
    bearCase: claims("bear_case", 12),
    keyRisks: claims("key_risks", 12),
    contradictions: requireStringArray(root.contradictions, "contradictions", 20),
    unknowns: requireStringArray(root.unknowns, "unknowns", 30),
    missingEvidence: requireStringArray(root.missing_evidence, "missing_evidence", 30)
  };
}

function parseConflict(value: unknown, evidenceIds: Set<string>): Critique["conflictingSources"][number] {
  const row = requireJsonObject(value, "conflicting source");
  if (typeof row.critical !== "boolean") throw new SchemaValidationError("Conflict critical must be boolean.");
  const ids = [...new Set(requireStringArray(row.evidence_ids, "conflict evidence_ids", 20))];
  if (ids.some((id) => !evidenceIds.has(id))) throw new SchemaValidationError("Conflict refers to unknown evidence.");
  return {
    description: requireString(row.description, "conflict description", 5, 1000),
    evidenceIds: ids,
    critical: row.critical
  };
}

export function validateCritique(value: unknown, questionIds: string[], evidenceIds: string[]): Critique {
  const root = requireJsonObject(value, "critic response");
  const allowedQuestions = new Set(questionIds);
  const allowedEvidence = new Set(evidenceIds);
  if (typeof root.retry_required !== "boolean") throw new SchemaValidationError("retry_required must be boolean.");
  const rawPriority = requireArray(root.retry_priority, "retry_priority", 20).map((value, index) => {
    const row = requireJsonObject(value, "retry_priority item " + index);
    const questionId = requireString(row.question_id, "retry question_id", 2, 12);
    if (!allowedQuestions.has(questionId)) throw new SchemaValidationError("Retry priority refers to an unknown question.");
    return {
      questionId,
      reason: requireString(row.reason, "retry reason", 5, 1000),
      priority: priority(row.priority)
    };
  });
  const unsupported = requireStringArray(root.unsupported_claims, "unsupported_claims", 30);
  const missingData = requireStringArray(root.missing_data, "missing_data", 30);
  const conflicts = requireArray(root.conflicting_sources, "conflicting_sources", 20)
    .map((row) => parseConflict(row, allowedEvidence));
  return {
    overallScore: requireScore(root.overall_score, "overall_score"),
    completenessScore: requireScore(root.completeness_score, "completeness_score"),
    evidenceScore: requireScore(root.evidence_score, "evidence_score"),
    recencyScore: requireScore(root.recency_score, "recency_score"),
    citationScore: requireScore(root.citation_score, "citation_score"),
    consistencyScore: requireScore(root.consistency_score, "consistency_score"),
    criticalErrors: requireStringArray(root.critical_errors, "critical_errors", 30),
    unsupportedClaims: unsupported,
    missingQuestions: requireStringArray(root.missing_questions, "missing_questions", 30),
    missingData,
    conflictingSources: conflicts,
    retryRequired: root.retry_required,
    retryPriority: rawPriority
  };
}

function parseFinalClaim(value: unknown, label: string, evidenceIds: Set<string>): FinalClaim {
  const row = requireJsonObject(value, label);
  const cited = [...new Set(requireStringArray(row.evidence_ids, label + " evidence_ids", 20))];
  if (cited.some((id) => !evidenceIds.has(id))) throw new SchemaValidationError(label + " cites evidence that was not collected.");
  return { text: requireString(row.text, label + " text", 3, 1400), evidenceIds: cited };
}

export function validateFinalReport(value: unknown, evidenceIds: string[]): FinalReport {
  const root = requireJsonObject(value, "finalizer response");
  if (root.status !== "COMPLETED" && root.status !== "LIMITED") throw new SchemaValidationError("Final report status is invalid.");
  if (root.confidence !== "NOT SCORED") throw new SchemaValidationError("Confidence must remain NOT SCORED.");
  if (root.quality_score !== null && (!Number.isInteger(root.quality_score) || Number(root.quality_score) < 0 || Number(root.quality_score) > 100)) {
    throw new SchemaValidationError("quality_score must be null or an integer from 0 to 100.");
  }
  const allowed = new Set(evidenceIds);
  const claimList = (key: string, max: number): FinalClaim[] =>
    requireArray(root[key], key, max).map((item, index) => parseFinalClaim(item, key + " item " + index, allowed));
  const verifiedEvidence = [...new Set(requireStringArray(root.verified_evidence, "verified_evidence", 50))];
  if (verifiedEvidence.some((id) => !allowed.has(id))) throw new SchemaValidationError("verified_evidence includes an unknown evidence ID.");
  return {
    status: root.status,
    classification: { classification: "unknown", source: null, verifiedAt: null, confidence: null },
    executiveSummary: parseFinalClaim(root.executive_summary, "executive_summary", allowed),
    whatHappened: claimList("what_happened", 20),
    verifiedEvidence,
    likelyDrivers: claimList("likely_drivers", 20),
    fundamentalContext: claimList("fundamental_context", 20),
    bullCase: claimList("bull_case", 20),
    bearCase: claimList("bear_case", 20),
    keyRisks: claimList("key_risks", 20),
    contradictoryEvidence: claimList("contradictory_evidence", 20),
    unknowns: requireStringArray(root.unknowns, "unknowns", 40),
    confidence: "NOT SCORED",
    qualityScore: root.quality_score === null ? null : Number(root.quality_score),
    limitations: requireStringArray(root.limitations, "limitations", 30)
  };
}
