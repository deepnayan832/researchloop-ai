import type { Analysis, Critique, EvidenceObject, ResearchPlan, ResearchQuestion } from "../types.js";
import { PASS_SCORE } from "../types.js";

export interface QualityGateResult {
  passed: boolean;
  score: number | null;
  criticalErrors: string[];
  unresolvedRequiredQuestions: string[];
  missingPrimaryQuestions: string[];
  criticalConflicts: string[];
  unsupportedClaims: string[];
  reasons: string[];
}

function answeredQuestionIds(evidence: EvidenceObject[]): Set<string> {
  const answered = new Set<string>();
  for (const item of evidence) {
    for (const id of item.supports) answered.add(id);
    for (const id of item.contradicts) answered.add(id);
  }
  return answered;
}

function blocksCompletion(question: ResearchQuestion): boolean {
  return question.required || question.priority === "high";
}

export function normalizeCritique(
  raw: Critique,
  plan: ResearchPlan,
  evidence: EvidenceObject[],
  analysis: Analysis
): Critique {
  const answered = answeredQuestionIds(evidence);
  const questions = new Map(plan.researchQuestions.map((question) => [question.id, question]));
  const missingRequired = plan.researchQuestions.filter((question) => blocksCompletion(question) && !answered.has(question.id));
  const retryPriority = new Map<string, Critique["retryPriority"][number]>();

  for (const question of missingRequired) {
    retryPriority.set(question.id, {
      questionId: question.id,
      reason: "Required research question has no cited supporting or contradicting evidence.",
      priority: question.priority
    });
  }
  for (const question of plan.researchQuestions) {
    const expectsPrimary = blocksCompletion(question) &&
      /(filing|exchange|quarterly|financial result|classification|small-cap|shareholding|promoter)/i.test(question.question);
    const hasEvidence = evidence.some((item) => item.questionIds.includes(question.id));
    const hasPrimary = evidence.some((item) => item.questionIds.includes(question.id) && item.sourceType === "primary");
    if (expectsPrimary && hasEvidence && !hasPrimary) retryPriority.set(question.id, {
      questionId: question.id,
      reason: "A required filing, result, classification, or ownership question has only secondary-source evidence.",
      priority: question.priority
    });
  }

  for (const item of raw.retryPriority) {
    const question = questions.get(item.questionId);
    if (!question) continue;
      const answeredOnlyBySecondary = blocksCompletion(question) &&
      /(filing|exchange|quarterly|financial result|classification|shareholding|promoter)/i.test(question.question) &&
      evidence.some((row) => row.questionIds.includes(question.id)) &&
      !evidence.some((row) => row.questionIds.includes(question.id) && row.sourceType === "primary");
    if (!answered.has(item.questionId) || answeredOnlyBySecondary) retryPriority.set(item.questionId, {
      ...item,
      reason: answeredOnlyBySecondary ? "Required question has only secondary-source evidence; a primary source is still needed." : item.reason
    });
  }

  const knownEvidence = new Set(evidence.map((item) => item.id));
  const unsupportedClaims = [...raw.unsupportedClaims];
  const criticalErrors = [...raw.criticalErrors];
  for (const claim of analysis.claims) {
    const invalid = claim.evidenceIds.filter((id) => !knownEvidence.has(id));
    if (invalid.length) {
      const message = "Analysis claim cites evidence that was not collected: " + claim.id;
      if (!criticalErrors.includes(message)) criticalErrors.push(message);
      if (!unsupportedClaims.includes(claim.text)) unsupportedClaims.push(claim.text);
    }
    if (claim.kind !== "UNKNOWN" && claim.evidenceIds.length === 0) {
      const message = "A material analysis claim has no evidence citation: " + claim.id;
      if (!criticalErrors.includes(message)) criticalErrors.push(message);
      if (!unsupportedClaims.includes(claim.text)) unsupportedClaims.push(claim.text);
    }
  }

  const retryable = [...retryPriority.values()];
  return {
    ...raw,
    criticalErrors: [...new Set(criticalErrors)],
    unsupportedClaims: [...new Set(unsupportedClaims)],
    missingQuestions: [...new Set([...raw.missingQuestions, ...missingRequired.map((question) => question.id)])],
    retryPriority: retryable,
    retryRequired: retryable.length > 0 || criticalErrors.length > 0
  };
}

export function evaluateQualityGate(input: {
  plan: ResearchPlan;
  evidence: EvidenceObject[];
  critique: Critique | null;
  analysis: Analysis | null;
}): QualityGateResult {
  const { plan, evidence, critique, analysis } = input;
  const answered = answeredQuestionIds(evidence);
  const unresolvedRequiredQuestions = plan.researchQuestions
    .filter((question) => blocksCompletion(question) && !answered.has(question.id))
    .map((question) => question.id);
  const missingPrimaryQuestions = plan.researchQuestions
    .filter((question) =>
      blocksCompletion(question) &&
      /(filing|exchange|quarterly|financial result|classification|small-cap|shareholding|promoter)/i.test(question.question) &&
      evidence.some((item) => item.questionIds.includes(question.id)) &&
      !evidence.some((item) => item.questionIds.includes(question.id) && item.sourceType === "primary"))
    .map((question) => question.id);
  const criticalErrors = critique?.criticalErrors ?? [];
  const criticalConflicts = critique?.conflictingSources.filter((conflict) => conflict.critical)
    .map((conflict) => conflict.description) ?? [];
  const unsupportedClaims = critique?.unsupportedClaims ?? [];
  const reasons: string[] = [];
  if (!critique) reasons.push("Critique is unavailable.");
  else if (critique.overallScore < PASS_SCORE) reasons.push("Critic score is below the pass threshold.");
  if (unresolvedRequiredQuestions.length) reasons.push("Required research questions remain unanswered.");
  if (missingPrimaryQuestions.length) reasons.push("Required questions have no primary-source evidence.");
  if (criticalErrors.length) reasons.push("The critic found critical errors.");
  if (criticalConflicts.length) reasons.push("Critical source conflicts remain unresolved.");
  if (unsupportedClaims.length) reasons.push("Unsupported material claims remain.");
  if (!analysis) reasons.push("Analysis is unavailable.");
  return {
    passed: Boolean(critique && analysis && critique.overallScore >= PASS_SCORE &&
      unresolvedRequiredQuestions.length === 0 && missingPrimaryQuestions.length === 0 && criticalErrors.length === 0 &&
      criticalConflicts.length === 0 && unsupportedClaims.length === 0),
    score: critique?.overallScore ?? null,
    criticalErrors,
    unresolvedRequiredQuestions,
    missingPrimaryQuestions,
    criticalConflicts,
    unsupportedClaims,
    reasons
  };
}

export function requiredQuestionMap(plan: ResearchPlan): Map<string, ResearchQuestion> {
  return new Map(plan.researchQuestions.filter((question) => question.required).map((question) => [question.id, question]));
}
