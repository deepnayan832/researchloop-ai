import type { Critique, ResearchPlan, SearchTask } from "../types.js";
import { MAX_ITERATIONS, MAX_RETRY_TASKS } from "../types.js";

export function iterationLimitReached(iteration: number, limit = MAX_ITERATIONS): boolean {
  return iteration >= limit;
}

export function createTargetedRetryInput(critique: Critique, plan: ResearchPlan): {
  gaps: Array<{ questionId: string; question: string; reason: string; priority: string }>;
  allowedQuestionIds: string[];
} {
  const questionMap = new Map(plan.researchQuestions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const gaps = critique.retryPriority
    .filter((item) => questionMap.has(item.questionId) && !seen.has(item.questionId) && seen.add(item.questionId))
    .slice(0, MAX_RETRY_TASKS)
    .map((item) => ({
      questionId: item.questionId,
      question: questionMap.get(item.questionId)!.question,
      reason: item.reason,
      priority: item.priority
    }));
  return { gaps, allowedQuestionIds: gaps.map((item) => item.questionId) };
}

export function validateTargetedTasks(value: unknown, allowedQuestionIds: string[]): SearchTask[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Gap resolver output must be an object.");
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.tasks) || root.tasks.length > MAX_RETRY_TASKS) throw new Error("Retry tasks must contain at most two items.");
  const allowed = new Set(allowedQuestionIds);
  return root.tasks.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Retry task must be an object.");
    const task = value as Record<string, unknown>;
    if (!Array.isArray(task.question_ids) || task.question_ids.length === 0) throw new Error("Retry task must name a question ID.");
    const questionIds = [...new Set(task.question_ids.map(String))];
    if (questionIds.some((id) => !allowed.has(id))) throw new Error("Retry task targeted a question that was not an identified gap.");
    if (typeof task.query !== "string" || task.query.trim().length < 4 || task.query.length > 500) throw new Error("Retry query is invalid.");
    const provider = task.provider;
    if (provider !== "tavily" && provider !== "gdelt" && provider !== "both") throw new Error("Retry provider is invalid.");
    return { questionIds, query: task.query.trim(), provider };
  });
}

export function gapSignature(critique: Critique): string {
  return critique.retryPriority
    .map((item) => item.questionId + ":" + item.reason.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .sort()
    .join("|");
}
