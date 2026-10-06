import { createHash } from "node:crypto";
import type { EvidenceObject, EvidenceKind, ResearchQuestion, SearchSource } from "../types.js";
import { SchemaValidationError } from "../errors.js";
import { requireArray, requireJsonObject, requireString, requireStringArray } from "../llm/provider.js";

const OFFICIAL_HOSTS = [
  "nseindia.com", "bseindia.com", "sebi.gov.in", "mca.gov.in", "rbi.org.in"
];

export function canonicalizeUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only HTTP(S) source URLs are accepted.");
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
}

export function classifySource(url: string): "primary" | "secondary" {
  let hostname = "";
  try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "secondary"; }
  if (OFFICIAL_HOSTS.some((host) => hostname === host || hostname.endsWith("." + host))) return "primary";
  if (hostname.endsWith(".gov.in") || hostname.endsWith(".nic.in")) return "primary";
  return "secondary";
}

export function sourceId(url: string): string {
  return "src_" + createHash("sha256").update(canonicalizeUrl(url)).digest("hex").slice(0, 18);
}

export function normalizePublicationDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return date.toISOString();
}

export function freshness(publicationDate: string | null): EvidenceObject["freshness"] {
  if (!publicationDate) return "unknown";
  const age = Date.now() - new Date(publicationDate).getTime();
  return age > 180 * 24 * 60 * 60 * 1000 ? "stale" : "current";
}

export function validateEvidenceOutput(
  input: unknown,
  sources: SearchSource[],
  questions: ResearchQuestion[]
): EvidenceObject[] {
  const root = requireJsonObject(input, "extractor response");
  const entries = requireArray(root.evidence, "evidence", 60);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const questionIds = new Set(questions.map((question) => question.id));
  const output: EvidenceObject[] = [];
  for (const [index, entry] of entries.entries()) {
    const item = requireJsonObject(entry, "evidence item " + index);
    const claim = requireString(item.claim, "claim", 8, 1200);
    const kind = item.kind;
    if (!["FACT", "INFERENCE", "ASSUMPTION", "UNKNOWN"].includes(String(kind))) {
      throw new SchemaValidationError("Evidence kind is invalid.");
    }
    const questionIdsForItem = [...new Set(requireStringArray(item.question_ids, "question_ids", 12))];
    const sourceIds = [...new Set(requireStringArray(item.source_ids, "source_ids", 12))];
    if (sourceIds.length === 0 || sourceIds.some((id) => !sourceMap.has(id))) {
      throw new SchemaValidationError("Evidence must cite source IDs that were retrieved in this run.");
    }
    if (questionIdsForItem.length === 0 || questionIdsForItem.some((id) => !questionIds.has(id))) {
      throw new SchemaValidationError("Evidence must refer to known plan questions.");
    }
    const supports = [...new Set(requireStringArray(item.supports || [], "supports", 12))];
    const contradicts = [...new Set(requireStringArray(item.contradicts || [], "contradicts", 12))];
    if ([...supports, ...contradicts].some((id) => !questionIds.has(id))) {
      throw new SchemaValidationError("Evidence support references an unknown research question.");
    }
    const sourceObjects = sourceIds.map((id) => sourceMap.get(id)!);
    const sourceType = sourceObjects.some((source) => source.sourceType === "primary") ? "primary" : "secondary";
    const publishers = [...new Set(sourceObjects.map((source) => source.publisher).filter(Boolean))];
    const dates = [...new Set(sourceObjects.map((source) => source.publicationDate).filter((date): date is string => Boolean(date)))];
    const text = requireString(item.evidence_text, "evidence_text", 5, 2500);
    output.push({
      id: "ev_" + createHash("sha256").update(claim.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).digest("hex").slice(0, 16),
      questionIds: questionIdsForItem,
      claim,
      kind: kind as EvidenceKind,
      sourceIds,
      sourceType,
      publisher: publishers.join(", "),
      publicationDate: dates.length === 1 ? dates[0]! : null,
      reportingPeriod: item.reporting_period === null ? null : requireString(item.reporting_period, "reporting_period", 1, 120),
      evidenceText: text,
      confidence: null,
      freshness: freshness(dates.length === 1 ? dates[0]! : null),
      supports,
      contradicts,
      sourceCount: sourceIds.length,
      independentEvidenceCount: new Set(sourceObjects.map((source) => source.domain)).size
    });
  }
  return output;
}

export function dedupeEvidence(items: EvidenceObject[]): EvidenceObject[] {
  const merged = new Map<string, EvidenceObject>();
  for (const item of items) {
    const key = item.claim.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + (item.reportingPeriod || "").toLowerCase();
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...item }); continue; }
    existing.sourceIds = [...new Set([...existing.sourceIds, ...item.sourceIds])];
    existing.questionIds = [...new Set([...existing.questionIds, ...item.questionIds])];
    existing.supports = [...new Set([...existing.supports, ...item.supports])];
    existing.contradicts = [...new Set([...existing.contradicts, ...item.contradicts])];
    existing.sourceType = existing.sourceType === "primary" || item.sourceType === "primary" ? "primary" : "secondary";
    existing.publisher = [...new Set([existing.publisher, item.publisher].filter(Boolean))].join(", ");
    existing.publicationDate = existing.publicationDate === item.publicationDate ? existing.publicationDate : null;
    existing.evidenceText = item.evidenceText.length > existing.evidenceText.length ? item.evidenceText : existing.evidenceText;
    existing.sourceCount = existing.sourceIds.length;
    const publisherDomains = new Set(
      [...existing.publisher.split(", "), ...item.publisher.split(", ")].map((value) => value.trim()).filter(Boolean)
    );
    existing.independentEvidenceCount = Math.max(existing.independentEvidenceCount, item.independentEvidenceCount, publisherDomains.size);
  }
  return [...merged.values()];
}
