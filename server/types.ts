export const MAX_ITERATIONS = 4;
export const PASS_SCORE = 85;
export const MAX_INITIAL_SEARCHES = 4;
export const MAX_RETRY_TASKS = 2;
export const MAX_TAVILY_SEARCHES = 8;
export const MAX_SOURCES_PER_SEARCH = 5;

export type Exchange = "NSE" | "BSE" | "NSE / BSE";
export type RunStatus = "running" | "completed" | "limited" | "failed";
export type Stage = "plan" | "research" | "evidence" | "analysis" | "critique" | "retry" | "finalize";
export type Priority = "high" | "medium" | "low";
export type EvidenceKind = "FACT" | "INFERENCE" | "ASSUMPTION" | "UNKNOWN";
export type SourceType = "primary" | "secondary";
export type MarketClassification = "small-cap" | "mid-cap" | "large-cap" | "SME" | "unknown";

export interface CompanyClassification {
  classification: MarketClassification;
  source: string | null;
  verifiedAt: string | null;
  confidence: number | null;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  priority: Priority;
  required: boolean;
}

export interface ResearchPlan {
  objective: string;
  researchQuestions: ResearchQuestion[];
}

export interface SearchTask {
  questionIds: string[];
  query: string;
  provider: "tavily" | "gdelt" | "both";
}

export interface SearchSource {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  snippet: string;
  publisher: string;
  domain: string;
  provider: string;
  sourceType: SourceType;
  publicationDate: string | null;
  retrievedAt: string;
  query: string;
  iteration: number;
}

export interface EvidenceObject {
  id: string;
  questionIds: string[];
  claim: string;
  kind: EvidenceKind;
  sourceIds: string[];
  sourceType: SourceType;
  publisher: string;
  publicationDate: string | null;
  reportingPeriod: string | null;
  evidenceText: string;
  confidence: null;
  freshness: "current" | "stale" | "unknown";
  supports: string[];
  contradicts: string[];
  sourceCount: number;
  independentEvidenceCount: number;
}

export interface AnalysisClaim {
  id: string;
  text: string;
  kind: EvidenceKind;
  evidenceIds: string[];
}

export interface Analysis {
  executiveSummary: string;
  whatHappened: string;
  fundamentalContext: string;
  claims: AnalysisClaim[];
  likelyDrivers: AnalysisClaim[];
  bullCase: AnalysisClaim[];
  bearCase: AnalysisClaim[];
  keyRisks: AnalysisClaim[];
  contradictions: string[];
  unknowns: string[];
  missingEvidence: string[];
}

export interface RetryPriority {
  questionId: string;
  reason: string;
  priority: Priority;
}

export interface Critique {
  overallScore: number;
  completenessScore: number;
  evidenceScore: number;
  recencyScore: number;
  citationScore: number;
  consistencyScore: number;
  criticalErrors: string[];
  unsupportedClaims: string[];
  missingQuestions: string[];
  missingData: string[];
  conflictingSources: Array<{ description: string; evidenceIds: string[]; critical: boolean }>;
  retryRequired: boolean;
  retryPriority: RetryPriority[];
}

export interface FinalClaim {
  text: string;
  evidenceIds: string[];
}

export interface FinalReport {
  status: "COMPLETED" | "LIMITED";
  classification: CompanyClassification;
  executiveSummary: FinalClaim;
  whatHappened: FinalClaim[];
  verifiedEvidence: string[];
  likelyDrivers: FinalClaim[];
  fundamentalContext: FinalClaim[];
  bullCase: FinalClaim[];
  bearCase: FinalClaim[];
  keyRisks: FinalClaim[];
  contradictoryEvidence: FinalClaim[];
  unknowns: string[];
  confidence: "NOT SCORED";
  qualityScore: number | null;
  limitations: string[];
}

export interface IterationSummary {
  iteration: number;
  searchTasks: number;
  sourcesAdded: number;
  sourcesChecked: number;
  primarySources: number;
  secondarySources: number;
  score: number | null;
  criticalGaps: string[];
  retryRequired: boolean;
  summary: string;
  createdAt: string;
}

export interface ProviderMetrics {
  llmCalls: number;
  llmRetryCount: number;
  llmTokens: number | null;
  tavilySearchCount: number;
  tavilyCreditEstimate: number | null;
  gdeltSearchCount: number;
  marketDataCalls: number;
  providerErrors: number;
  cost: "DATA NOT AVAILABLE";
}

export interface ResearchRun {
  id: string;
  query: string;
  exchange: Exchange;
  status: RunStatus;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
  initialScore: number | null;
  finalScore: number | null;
  sourcesChecked: number;
  primarySources: number;
  secondarySources: number;
  criticalGapsFound: number;
  criticalGapsResolved: number;
  unresolvedGaps: number;
  gaps: string[];
  metrics: ProviderMetrics;
  plan: ResearchPlan | null;
  analysis: Analysis | null;
  critique: Critique | null;
  report: FinalReport | null;
  iterations: IterationSummary[];
  sources: SearchSource[];
  evidence: EvidenceObject[];
  trace: Array<{ stage: string; title: string; detail: string; at: string; status?: string }>;
}

export interface ProviderHealth {
  status: "configured" | "missing" | "available" | "error" | "healthy";
  detail?: string;
}

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  tavilyApiKey: string;
  marketDataProvider: string;
  marketDataBaseUrl: string;
  marketDataApiKey: string;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type UsageCallback = (provider: string, usage?: ProviderUsage, error?: string) => void;
