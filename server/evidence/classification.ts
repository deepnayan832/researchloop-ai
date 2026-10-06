import type { CompanyClassification, EvidenceObject, ResearchPlan, SearchSource } from "../types.js";
import { classifySource } from "./store.js";

const UNKNOWN: CompanyClassification = {
  classification: "unknown",
  source: null,
  verifiedAt: null,
  confidence: null
};

function companyIdentifier(query: string): string | null {
  const explicit = /\b(?:NSE|BSE)\s*[:\-]\s*([A-Z0-9][A-Z0-9.&-]{1,19})\b/i.exec(query);
  if (explicit) return explicit[1]!.toLowerCase();
  const name = /\b([A-Z][A-Z0-9.&-]{1,18})\s+(?:Ltd\.?|Limited|Industries|India)\b/i.exec(query);
  return name?.[1]?.toLowerCase() ?? null;
}

export function deriveCompanyClassification(
  query: string,
  plan: ResearchPlan | null,
  evidence: EvidenceObject[],
  sources: SearchSource[]
): CompanyClassification {
  if (!plan) return { ...UNKNOWN };
  const classificationQuestionIds = new Set(plan.researchQuestions
    .filter((question) => /small[- ]cap|classification|market cap|SME/i.test(question.question))
    .map((question) => question.id));
  const identifier = companyIdentifier(query);
  if (!classificationQuestionIds.size || !identifier) return { ...UNKNOWN };
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  for (const item of evidence) {
    if (item.kind !== "FACT" || !item.questionIds.some((id) => classificationQuestionIds.has(id))) continue;
    const claim = item.claim.toLowerCase();
    if (!claim.includes(identifier)) continue;
    const match = /\b(small[- ]cap|mid[- ]cap|large[- ]cap|SME)\b/i.exec(item.claim);
    if (!match) continue;
    const before = claim.slice(Math.max(0, match.index - 45), match.index);
    if (/\b(not|no|unknown|unverified|unable|cannot)\b/i.test(before)) continue;
    const source = item.sourceIds.map((id) => sourceMap.get(id)).find((candidate) =>
      candidate && candidate.sourceType === "primary" && classifySource(candidate.url) === "primary" &&
      candidate.publicationDate && item.freshness === "current"
    );
    if (!source) continue;
    const label = match[1]!.toLowerCase().replace(/\s/g, "-") as CompanyClassification["classification"];
    return {
      classification: label === "small-cap" || label === "mid-cap" || label === "large-cap" ? label : "SME",
      source: source.url,
      verifiedAt: source.retrievedAt,
      confidence: null
    };
  }
  return { ...UNKNOWN };
}
