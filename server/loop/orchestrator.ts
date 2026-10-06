import { randomUUID } from "node:crypto";
import type {
  Analysis, AppConfig, Critique, EvidenceObject, Exchange, FinalClaim, FinalReport, IterationSummary,
  ProviderMetrics, ResearchPlan, ResearchQuestion, ResearchRun, SearchSource, SearchTask, Stage
} from "../types.js";
import {
  MAX_ITERATIONS, MAX_INITIAL_SEARCHES, MAX_RETRY_TASKS, MAX_TAVILY_SEARCHES, PASS_SCORE
} from "../types.js";
import { ProviderError } from "../errors.js";
import { ResearchStore, defaultProviderMetrics } from "../db/index.js";
import { PromptRegistry, type PromptName } from "../prompts.js";
import { OpenAICompatibleProvider, type LLMProvider, type Validator } from "../llm/provider.js";
import { validateEvidenceOutput, canonicalizeUrl, sourceId } from "../evidence/store.js";
import { deriveCompanyClassification } from "../evidence/classification.js";
import { TavilyResearchProvider } from "../research/tavily.js";
import { GdeltResearchProvider } from "../research/gdelt.js";
import { createMarketProvider, type MarketDataProvider } from "../market/provider.js";
import { evaluateQualityGate, normalizeCritique } from "../evaluation/critic.js";
import { createTargetedRetryInput, gapSignature, iterationLimitReached } from "./retry-controller.js";
import {
  validateAnalysis, validateCritique, validateFinalReport, validatePlan, validateSearchTasks
} from "./validators.js";
import { logRun } from "../logger.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function userExchange(exchange: Exchange): Exchange {
  return exchange;
}

function querySymbol(query: string): string | null {
  const explicit = /\b(?:NSE|BSE)\s*[:\-]\s*([A-Z0-9][A-Z0-9.&-]{1,19})\b/i.exec(query);
  if (explicit) return explicit[1]!.toUpperCase();
  const company = /\b([A-Z][A-Z0-9.&-]{1,14})\s+(?:LTD\.?|LIMITED|INDUSTRIES|INDIA)\b/.exec(query);
  return company?.[1] ?? null;
}

function needsMarketData(query: string): boolean {
  return /\b(price|share price|stock price|market move|volume|quote|rose|rises|rise|fell|falls|today|yesterday|trading)\b/i.test(query);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function asLimitedReport(
  reason: string,
  unknowns: string[] = [],
  qualityScore: number | null = null,
  classification: FinalReport["classification"] = { classification: "unknown", source: null, verifiedAt: null, confidence: null }
): FinalReport {
  return {
    status: "LIMITED",
    classification,
    executiveSummary: { text: "Research is limited. " + reason, evidenceIds: [] },
    whatHappened: [],
    verifiedEvidence: [],
    likelyDrivers: [],
    fundamentalContext: [],
    bullCase: [],
    bearCase: [],
    keyRisks: [],
    contradictoryEvidence: [],
    unknowns: unique(unknowns.length ? unknowns : [reason]),
    confidence: "NOT SCORED",
    qualityScore,
    limitations: [reason]
  };
}

function limitedReportFromEvidence(
  gateReasons: string[],
  unknowns: string[],
  evidence: EvidenceObject[],
  score: number | null,
  classification: FinalReport["classification"]
): FinalReport {
  const facts: FinalClaim[] = evidence
    .filter((item) => item.kind === "FACT" && item.sourceIds.length > 0)
    .slice(0, 12)
    .map((item) => ({ text: item.claim, evidenceIds: [item.id] }));
  const limitedReason = gateReasons.join(" ");
  return {
    status: "LIMITED",
    classification,
    executiveSummary: {
      text: "Research remains limited because the final quality gate did not pass. " + limitedReason +
        " Retrieved facts below are source-linked; they do not establish a cause or investment outcome.",
      evidenceIds: []
    },
    whatHappened: facts,
    verifiedEvidence: facts.map((item) => item.evidenceIds[0]!),
    likelyDrivers: [],
    fundamentalContext: [],
    bullCase: [],
    bearCase: [],
    keyRisks: [],
    contradictoryEvidence: [],
    unknowns: unique(unknowns).slice(0, 30),
    confidence: "NOT SCORED",
    qualityScore: score,
    limitations: unique(gateReasons)
  };
}

export class ResearchOrchestrator {
  private readonly llm: LLMProvider;
  private readonly tavily: Pick<TavilyResearchProvider, "configured" | "search">;
  private readonly gdelt: Pick<GdeltResearchProvider, "available" | "search">;
  private readonly market: MarketDataProvider;
  private readonly prompts: PromptRegistry;
  private readonly metricsByRun = new Map<string, ProviderMetrics>();
  private readonly running = new Set<string>();

  constructor(
    private readonly store: ResearchStore,
    private readonly config: AppConfig,
    dependencies?: {
      llm?: LLMProvider;
      tavily?: Pick<TavilyResearchProvider, "configured" | "search">;
      gdelt?: Pick<GdeltResearchProvider, "available" | "search">;
      market?: MarketDataProvider;
      prompts?: PromptRegistry;
    }
  ) {
    this.llm = dependencies?.llm || new OpenAICompatibleProvider(config);
    this.tavily = dependencies?.tavily || new TavilyResearchProvider(config);
    this.gdelt = dependencies?.gdelt || new GdeltResearchProvider();
    this.market = dependencies?.market || createMarketProvider(config);
    this.prompts = dependencies?.prompts || new PromptRegistry();
  }

  getProviderHealth(): Record<string, string> {
    return {
      llm: this.llm.configured ? "configured" : "missing",
      llm_detail: this.llm.configured
        ? "Server-side OpenAI-compatible endpoint and model are configured."
        : "Set LLM_API_KEY and LLM_MODEL in the server environment.",
      tavily: this.tavily.configured ? "configured" : "missing",
      tavily_detail: this.tavily.configured
        ? "Backend web search is configured."
        : "Set TAVILY_API_KEY to enable web search.",
      gdelt: "available",
      gdelt_detail: "Public news discovery endpoint; results are secondary sources.",
      market_data: this.market.configured ? "configured" : "missing",
      market_data_detail: this.market.configured
        ? "Yahoo Finance chart adapter is enabled; verify retrieved values against an exchange source."
        : "Market data adapter is not configured."
    };
  }

  start(runId: string): void {
    if (this.running.has(runId)) return;
    this.running.add(runId);
    void this.execute(runId).finally(() => this.running.delete(runId));
  }

  async execute(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    const metrics = defaultProviderMetrics();
    this.metricsByRun.set(runId, metrics);
    let plan: ResearchPlan | null = null;
    let latestAnalysis: Analysis | null = null;
    let latestCritique: Critique | null = null;
    let latestEvidence: EvidenceObject[] = [];
    let qualityReasons: string[] = [];
    let score: number | null = null;
    let iterationCount = 0;
    const allGapIds = new Set<string>();
    const resolvedGapIds = new Set<string>();

    if (!this.llm.configured) {
      this.stage(runId, 0, "plan", "unavailable", "Planning unavailable", "LLM_API_KEY and LLM_MODEL are not configured; no AI plan or live research was run.");
      this.stage(runId, 0, "research", "skipped", "Research not run", "No live evidence was collected because the planner is unavailable.");
      const report = asLimitedReport("The LLM provider is not configured, so planning, evidence extraction, analysis, and critique did not run.",
        ["The requested research questions are unknown.", "No current source, filing, price, or volume was checked."]);
      this.store.saveReport(runId, report);
      this.store.patchRun(runId, {
        status: "limited", stage: "finalize", iterationCount: 0, finalScore: null, sourcesChecked: 0,
        primarySources: 0, secondarySources: 0, unresolvedGaps: 0, gaps: report.unknowns, metrics
      });
      this.stage(runId, 0, "finalize", "limited", "Limitation report recorded", "No finalizer model call was made because live model configuration is missing.");
      this.finish(runId, "limited", report, null, metrics);
      return;
    }

    try {
      this.stage(runId, 0, "plan", "started", "Planning started", "The submitted query is being converted to atomic research questions.");
      plan = await this.structured(runId, 0, "plan", "planner", {
        query: run.query,
        exchange: run.exchange
      }, validatePlan);
      this.store.savePlan(runId, plan);
      this.stage(runId, 0, "plan", "completed", "Plan prepared", plan.researchQuestions.length + " research questions were created.");

      let previousGapSignature = "";
      let lastGate = null;
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
        iterationCount = iteration;
        this.store.patchRun(runId, { status: "running", stage: "research", iterationCount, metrics });
        this.stage(runId, iteration, iteration === 1 ? "research" : "retry", "started",
          iteration === 1 ? "Research started" : "Targeted retry started",
          iteration === 1 ? "Retrieving evidence for the initial high-priority questions." : "Searching only for the unresolved questions from the previous critique.");

        const questions = iteration === 1
          ? plan.researchQuestions
          : this.retryQuestions(plan, latestCritique);
        let tasks: SearchTask[];
        if (iteration === 1) {
          tasks = await this.structured(runId, iteration, "research", "researcher", {
            query: run.query,
            exchange: run.exchange,
            objective: plan.objective,
            questions,
            maxTasks: MAX_INITIAL_SEARCHES,
            sourcePriority: ["exchange filing", "regulator", "company investor relations", "reputable financial news"]
          }, (value) => validateSearchTasks(value, questions.map((question) => question.id)));
        } else {
          const retryInput = createTargetedRetryInput(latestCritique!, plan);
          tasks = await this.structured(runId, iteration, "retry", "gap-resolver", {
            query: run.query,
            exchange: run.exchange,
            unresolvedGaps: retryInput.gaps,
            allowedQuestionIds: retryInput.allowedQuestionIds,
            maxTasks: MAX_RETRY_TASKS
          }, (value) => validateSearchTasks(value, retryInput.allowedQuestionIds, true));
        }
        const priorSourceCount = this.store.getRun(runId)?.sources.length ?? 0;
        await this.retrieveSources(run, iteration, tasks, metrics);
        const afterSearch = this.store.getRun(runId)!;
        const sourcesAdded = Math.max(0, afterSearch.sources.length - priorSourceCount);
        const allSources = afterSearch.sources;
        const evidenceInput = allSources.slice(0, 16).map((source) => ({
          id: source.id, url: source.url, title: source.title, publisher: source.publisher,
          source_type: source.sourceType, publication_date: source.publicationDate,
          retrieved_at: source.retrievedAt, query: source.query, content: source.snippet.slice(0, 3000)
        }));

        this.stage(runId, iteration, "evidence", "started", "Evidence extraction started", allSources.length + " deduplicated source URLs are available to the extractor.");
        if (evidenceInput.length) {
          const extracted = await this.structured(runId, iteration, "evidence", "extractor", {
            query: run.query,
            questions: plan.researchQuestions,
            sources: evidenceInput
          }, (value) => validateEvidenceOutput(value, allSources, plan!.researchQuestions));
          this.store.addEvidence(runId, extracted);
        }
        latestEvidence = this.store.getRun(runId)!.evidence;
        this.stage(runId, iteration, "evidence", "completed", "Evidence recorded",
          latestEvidence.length + " deduplicated fact groups cite " + this.store.getRun(runId)!.sources.length + " source URLs.");

        this.store.patchRun(runId, { stage: "analysis", metrics });
        this.stage(runId, iteration, "analysis", "started", "Analysis started", "The analyst is limited to the retrieved evidence objects.");
        latestAnalysis = await this.structured(runId, iteration, "analysis", "analyst", {
          query: run.query,
          objective: plan.objective,
          questions: plan.researchQuestions,
          evidence: latestEvidence
        }, (value) => validateAnalysis(value, latestEvidence.map((item) => item.id)));
        this.store.saveAnalysis(runId, latestAnalysis);
        this.stage(runId, iteration, "analysis", "completed", "Analysis recorded",
          latestAnalysis.claims.length + " material claims were checked for evidence references.");

        this.store.patchRun(runId, { stage: "critique", metrics });
        this.stage(runId, iteration, "critique", "started", "Adversarial critique started", "Required questions, sources, citations, conflicts, and causal claims are being checked.");
        const criticOutput = await this.structured(runId, iteration, "critique", "critic", {
          query: run.query,
          objective: plan.objective,
          questions: plan.researchQuestions,
          sources: this.store.getRun(runId)!.sources.map((source) => ({
            id: source.id, title: source.title, domain: source.domain, source_type: source.sourceType,
            publication_date: source.publicationDate, provider: source.provider
          })),
          evidence: latestEvidence,
          analysis: latestAnalysis
        }, (value) => validateCritique(value, plan!.researchQuestions.map((question) => question.id), latestEvidence.map((item) => item.id)));
        latestCritique = normalizeCritique(criticOutput, plan, latestEvidence, latestAnalysis);
        this.store.saveCritique(runId, iteration, latestCritique);
        score = latestCritique.overallScore;
        lastGate = evaluateQualityGate({ plan, evidence: latestEvidence, critique: latestCritique, analysis: latestAnalysis });
        qualityReasons = lastGate.reasons;
        for (const gap of latestCritique.retryPriority) allGapIds.add(gap.questionId);
        const unresolvedIds = new Set(latestCritique.retryPriority.map((gap) => gap.questionId));
        if (iteration > 1) {
          for (const id of allGapIds) if (!unresolvedIds.has(id)) resolvedGapIds.add(id);
        }
        const gapNames = latestCritique.retryPriority.map((gap) => gap.questionId + ": " + gap.reason);
        const summary = "Critic score " + latestCritique.overallScore + "/100; " +
          latestCritique.retryPriority.length + " targeted gap(s); " + afterSearch.sources.length + " sources total.";
        const item: IterationSummary = {
          iteration,
          searchTasks: tasks.length,
          sourcesAdded,
          sourcesChecked: afterSearch.sources.length,
          primarySources: afterSearch.sources.filter((source) => source.sourceType === "primary").length,
          secondarySources: afterSearch.sources.filter((source) => source.sourceType === "secondary").length,
          score: latestCritique.overallScore,
          criticalGaps: gapNames,
          retryRequired: latestCritique.retryRequired,
          summary,
          createdAt: new Date().toISOString()
        };
        this.store.saveIteration(runId, item);
        this.store.patchRun(runId, {
          iterationCount: iteration,
          initialScore: iteration === 1 ? latestCritique.overallScore : undefined,
          finalScore: latestCritique.overallScore,
          sourcesChecked: afterSearch.sources.length,
          primarySources: item.primarySources,
          secondarySources: item.secondarySources,
          criticalGapsFound: allGapIds.size,
          criticalGapsResolved: resolvedGapIds.size,
          unresolvedGaps: latestCritique.retryPriority.length,
          gaps: gapNames,
          metrics
        });
        this.stage(runId, iteration, "critique", "completed", "Critique completed",
          "Quality score " + latestCritique.overallScore + "/" + PASS_SCORE + "; " +
          (latestCritique.retryRequired ? "targeted retry required." : "no retry requested."),
          { score: latestCritique.overallScore, retryRequired: latestCritique.retryRequired, criticalGaps: gapNames });

        if (lastGate.passed) break;
        if (!latestCritique.retryRequired || iterationLimitReached(iteration)) break;
        const signature = gapSignature(latestCritique);
        if (iteration > 1 && sourcesAdded === 0 && signature === previousGapSignature) {
          qualityReasons = [...qualityReasons, "The same gaps remained and the targeted retry added no new source URLs; research stopped early."];
          this.stage(runId, iteration, "retry", "stopped", "Retry stopped", "The same gaps remained and no new sources were added.");
          break;
        }
        previousGapSignature = signature;
        const retryCandidate = createTargetedRetryInput(latestCritique, plan);
        if (!retryCandidate.gaps.length) break;
        this.stage(runId, iteration + 1, "retry", "planned", "Targeted retry planned",
          "Only " + retryCandidate.gaps.map((gap) => gap.questionId).join(", ") + " will be searched.",
          { targetQuestionIds: retryCandidate.allowedQuestionIds });
      }

      this.store.patchRun(runId, { stage: "finalize", metrics });
      const finalGate = evaluateQualityGate({ plan, evidence: latestEvidence, critique: latestCritique, analysis: latestAnalysis });
      const gatePassed = Boolean(lastGate?.passed && finalGate.passed);
      const classification = deriveCompanyClassification(run.query, plan, latestEvidence, this.store.getRun(runId)!.sources);
      let report: FinalReport;
      if (gatePassed) {
        this.stage(runId, iterationCount, "finalize", "started", "Finalization started", "The quality gate passed; the finalizer is producing the cited report.");
        report = await this.structured(runId, iterationCount, "finalize", "finalizer", {
          query: run.query,
          exchange: run.exchange,
          plan,
          evidence: latestEvidence,
          analysis: latestAnalysis,
          critique: latestCritique,
          classification,
          qualityGate: finalGate,
          requiredStatus: "COMPLETED"
        }, (value) => validateFinalReport(value, latestEvidence.map((item) => item.id)));
        report = {
          ...report,
          status: "COMPLETED",
          classification,
          confidence: "NOT SCORED",
          qualityScore: latestCritique!.overallScore,
          limitations: unique([...report.limitations, ...latestCritique!.missingData])
        };
      } else {
        const remainingUnknowns = unique([
          ...latestAnalysis!.unknowns,
          ...latestAnalysis!.missingEvidence,
          ...latestCritique?.missingData ?? [],
          ...latestCritique?.retryPriority.map((gap) => gap.reason) ?? [],
          ...qualityReasons
        ]);
        report = limitedReportFromEvidence(
          qualityReasons.length ? qualityReasons : ["One or more required evidence or critique conditions remain unresolved."],
          remainingUnknowns,
          latestEvidence,
          latestCritique?.overallScore ?? null,
          classification
        );
        this.stage(runId, iterationCount, "finalize", "limited", "Limited report prepared",
          "The quality gate did not pass. The finalizer was skipped; no conclusion was promoted beyond source-linked facts.");
      }
      this.store.saveReport(runId, report);
      const finalStatus = gatePassed ? "completed" : "limited";
      this.store.patchRun(runId, {
        status: finalStatus,
        stage: "finalize",
        finalScore: latestCritique?.overallScore ?? null,
        iterationCount,
        sourcesChecked: this.store.getRun(runId)!.sources.length,
        primarySources: this.store.getRun(runId)!.sources.filter((source) => source.sourceType === "primary").length,
        secondarySources: this.store.getRun(runId)!.sources.filter((source) => source.sourceType === "secondary").length,
        criticalGapsFound: allGapIds.size,
        criticalGapsResolved: resolvedGapIds.size,
        unresolvedGaps: latestCritique?.retryPriority.length ?? 0,
        gaps: report.limitations,
        metrics
      });
      this.stage(runId, iterationCount, "finalize", gatePassed ? "completed" : "limited",
        gatePassed ? "Research completed" : "Research limited",
        gatePassed ? "Quality gate passed and the source-cited report is ready." : "Research stopped with unresolved limitations.",
        { score: latestCritique?.overallScore ?? null, qualityGatePassed: gatePassed });
      this.finish(runId, finalStatus, report, latestCritique, metrics);
    } catch (error) {
      const providerFailure = error instanceof ProviderError;
      const safeMessage = error instanceof Error ? error.message : "Unexpected research error.";
      const finalStatus = providerFailure ? "limited" : "failed";
      const current = this.store.getRun(runId);
      const classification = deriveCompanyClassification(run.query, plan, current?.evidence ?? [], current?.sources ?? []);
      const report = asLimitedReport(
        "The research workflow stopped during " + (current?.stage || "execution") + ": " + safeMessage,
        [
          ...(plan?.researchQuestions.map((question) => question.question) ?? ["The research plan could not be completed."]),
          ...(latestCritique?.retryPriority.map((gap) => gap.reason) ?? [])
        ],
        score,
        classification
      );
      this.store.saveReport(runId, report);
      this.store.patchRun(runId, {
        status: finalStatus,
        stage: current?.stage || "finalize",
        iterationCount,
        finalScore: score,
        sourcesChecked: current?.sources.length ?? 0,
        primarySources: current?.sources.filter((source) => source.sourceType === "primary").length ?? 0,
        secondarySources: current?.sources.filter((source) => source.sourceType === "secondary").length ?? 0,
        unresolvedGaps: latestCritique?.retryPriority.length ?? 0,
        gaps: report.limitations,
        metrics
      });
      this.record(runId, iterationCount, String(current?.stage || "execution"), "orchestrator", 0, finalStatus, safeMessage);
      this.stage(runId, iterationCount, current?.stage || "finalize", "error", "Research stopped", safeMessage);
      this.finish(runId, finalStatus, report, latestCritique, metrics);
    }
  }

  private retryQuestions(plan: ResearchPlan, critique: Critique | null): ResearchQuestion[] {
    const candidate = createTargetedRetryInput(critique!, plan);
    const allowed = new Set(candidate.allowedQuestionIds);
    return plan.researchQuestions.filter((question) => allowed.has(question.id));
  }

  private async structured<T>(
    runId: string,
    iteration: number,
    stage: Stage,
    promptName: PromptName,
    input: unknown,
    validator: Validator<T>
  ): Promise<T> {
    const start = Date.now();
    let callbackCount = 0;
    let providerErrorSeen = false;
    const onUsage = (_provider: string, usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number }, error?: string) => {
      callbackCount += 1;
      if (usage) {
        const total = usage.totalTokens ?? (usage.promptTokens !== undefined && usage.completionTokens !== undefined
          ? usage.promptTokens + usage.completionTokens : null);
        if (total !== null) {
          const metrics = this.metricsByRun.get(runId)!;
          metrics.llmTokens = (metrics.llmTokens ?? 0) + total;
        }
      }
      if (error) {
        this.metricsByRun.get(runId)!.providerErrors += 1;
        providerErrorSeen = true;
      }
    };
    try {
      const result = await this.llm.generateStructured(
        this.prompts.get("system"),
        this.prompts.get(promptName),
        json(input),
        validator,
        onUsage
      );
      const metrics = this.metricsByRun.get(runId)!;
      metrics.llmCalls += callbackCount || 1;
      metrics.llmRetryCount += Math.max(0, callbackCount - 1);
      this.store.patchRun(runId, { metrics });
      this.record(runId, iteration, stage, "llm", Date.now() - start, "ok", null);
      return result;
    } catch (error) {
      const metrics = this.metricsByRun.get(runId)!;
      metrics.llmCalls += callbackCount || 1;
      metrics.llmRetryCount += Math.max(0, callbackCount - 1);
      if (!providerErrorSeen) metrics.providerErrors += 1;
      this.store.patchRun(runId, { metrics });
      const message = error instanceof Error ? error.message : "LLM operation failed.";
      this.record(runId, iteration, stage, "llm", Date.now() - start, "error", message);
      throw error;
    }
  }

  private async retrieveSources(run: ResearchRun, iteration: number, tasks: SearchTask[], metrics: ProviderMetrics): Promise<void> {
    let gdeltUsed = false;
    const found: SearchSource[] = [];
    for (const task of tasks.slice(0, iteration === 1 ? MAX_INITIAL_SEARCHES : MAX_RETRY_TASKS)) {
      if ((task.provider === "tavily" || task.provider === "both") && metrics.tavilySearchCount < MAX_TAVILY_SEARCHES) {
        if (!this.tavily.configured) {
          this.record(run.id, iteration, "research", "tavily", 0, "unavailable", "TAVILY_API_KEY is not configured; no search was performed.");
          if (!gdeltUsed) {
            gdeltUsed = true;
            const started = Date.now();
            metrics.gdeltSearchCount += 1;
            try {
              const sources = await this.gdelt.search(task.query, iteration);
              found.push(...sources);
              this.record(run.id, iteration, "research", "gdelt", Date.now() - started, sources.length ? "ok" : "empty", null);
            } catch (error) {
              metrics.providerErrors += 1;
              this.record(run.id, iteration, "research", "gdelt", Date.now() - started, "error", error instanceof Error ? error.message : "GDELT error.");
            }
          }
        } else {
          const started = Date.now();
          metrics.tavilySearchCount += 1;
          try {
            const result = await this.tavily.search(task.query, iteration);
            found.push(...result.sources);
            if (result.credits === null) metrics.tavilyCreditEstimate = null;
            else if (metrics.tavilyCreditEstimate !== null) metrics.tavilyCreditEstimate += result.credits;
            this.record(run.id, iteration, "research", "tavily", Date.now() - started, result.sources.length ? "ok" : "empty", null);
          } catch (error) {
            metrics.providerErrors += 1;
            this.record(run.id, iteration, "research", "tavily", Date.now() - started, "error", error instanceof Error ? error.message : "Tavily error.");
          }
        }
      }
      if ((task.provider === "gdelt" || task.provider === "both") && !gdeltUsed) {
        gdeltUsed = true;
        const started = Date.now();
        metrics.gdeltSearchCount += 1;
        try {
          const sources = await this.gdelt.search(task.query, iteration);
          found.push(...sources);
          this.record(run.id, iteration, "research", "gdelt", Date.now() - started, sources.length ? "ok" : "empty", null);
        } catch (error) {
          metrics.providerErrors += 1;
          this.record(run.id, iteration, "research", "gdelt", Date.now() - started, "error", error instanceof Error ? error.message : "GDELT error.");
        }
      }
    }
    if (iteration === 1 && !gdeltUsed && tasks.length > 0) {
      const started = Date.now();
      metrics.gdeltSearchCount += 1;
      try {
        const sources = await this.gdelt.search(tasks[0]!.query, iteration);
        found.push(...sources);
        this.record(run.id, iteration, "research", "gdelt", Date.now() - started, sources.length ? "ok" : "empty", null);
      } catch (error) {
        metrics.providerErrors += 1;
        this.record(run.id, iteration, "research", "gdelt", Date.now() - started, "error", error instanceof Error ? error.message : "GDELT error.");
      }
    }

    const symbol = querySymbol(run.query);
    if (iteration === 1 && symbol && needsMarketData(run.query) && this.market.configured) {
      const started = Date.now();
      metrics.marketDataCalls += 1;
      try {
        const quoteResult = await this.market.getQuote(symbol, userExchange(run.exchange));
        if (quoteResult.status === "AVAILABLE") {
          const quote = quoteResult.data;
          if (Object.values({
          price: quote.price, previousClose: quote.previousClose, open: quote.open,
          high: quote.dayHigh, low: quote.dayLow, volume: quote.volume
        }).some((value) => value !== null)) {
          const canonical = canonicalizeUrl(quote.sourceUrl);
          found.push({
            id: sourceId(canonical), url: quote.sourceUrl, canonicalUrl: canonical,
            title: "Market quote for " + quote.symbol + " from " + quote.provider,
            snippet: json({
              symbol: quote.symbol, exchange: quote.exchange, company_name: quote.name || "DATA NOT AVAILABLE",
              price: quote.price === null ? "DATA NOT AVAILABLE" : quote.price,
              currency: quote.currency || "DATA NOT AVAILABLE",
              previous_close: quote.previousClose === null ? "DATA NOT AVAILABLE" : quote.previousClose,
              open: quote.open === null ? "DATA NOT AVAILABLE" : quote.open,
              day_high: quote.dayHigh === null ? "DATA NOT AVAILABLE" : quote.dayHigh,
              day_low: quote.dayLow === null ? "DATA NOT AVAILABLE" : quote.dayLow,
              volume: quote.volume === null ? "DATA NOT AVAILABLE" : quote.volume,
              timestamp: quote.timestamp || "DATA NOT AVAILABLE"
            }),
            publisher: quote.provider, domain: new URL(canonical).hostname.toLowerCase().replace(/^www\./, ""),
            provider: "market_data", sourceType: "secondary", publicationDate: quote.timestamp,
            retrievedAt: new Date().toISOString(), query: run.query, iteration
          });
          this.record(run.id, iteration, "research", "market_data", Date.now() - started, "ok", null);
          } else {
            this.record(run.id, iteration, "research", "market_data", Date.now() - started, "empty", null);
          }
        } else {
          this.record(run.id, iteration, "research", "market_data", Date.now() - started, "empty", null);
        }
      } catch (error) {
        metrics.providerErrors += 1;
        this.record(run.id, iteration, "research", "market_data", Date.now() - started, "error", error instanceof Error ? error.message : "Market data error.");
      }
    }
    this.store.addSources(run.id, found);
    this.store.patchRun(run.id, { metrics });
  }

  private stage(
    runId: string,
    iteration: number,
    stage: Stage,
    status: string,
    title: string,
    detail: string,
    extra: Record<string, unknown> = {}
  ): void {
    const metrics = this.metricsByRun.get(runId);
    if (metrics) this.store.patchRun(runId, { stage, metrics });
    this.store.appendEvent(runId, { type: "stage", stage, status, title, detail, iteration, maxIterations: MAX_ITERATIONS, ...extra });
    logRun({ runId, iteration, stage, provider: "orchestrator", durationMs: 0, result: status, error: status === "error" ? detail : undefined });
  }

  private record(runId: string, iteration: number, stage: string, provider: string, durationMs: number, result: string, error: string | null): void {
    this.store.logProvider(runId, iteration, stage, provider, durationMs, result, error);
    logRun({ runId, iteration, stage, provider, durationMs, result, error });
  }

  private finish(runId: string, status: "completed" | "limited" | "failed", report: FinalReport, critique: Critique | null, metrics: ProviderMetrics): void {
    this.store.appendEvent(runId, {
      type: "final", status, score: critique?.overallScore ?? null,
      retryRequired: critique?.retryRequired ?? false,
      reportReady: Boolean(report), metrics
    });
    this.store.patchRun(runId, { status, metrics });
  }
}
