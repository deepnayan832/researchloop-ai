import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Analysis, Critique, EvidenceObject, Exchange, FinalReport, IterationSummary,
  ProviderMetrics, ResearchPlan, ResearchRun, SearchSource, RunStatus, Stage
} from "../types.js";
import { resolveDatabasePath } from "../config.js";

type SqlRow = Record<string, string | number | null>;
type RunPatch = Partial<Pick<ResearchRun,
  "status" | "stage" | "iterationCount" | "initialScore" | "finalScore" | "sourcesChecked" |
  "primarySources" | "secondarySources" | "criticalGapsFound" | "criticalGapsResolved" |
  "unresolvedGaps" | "gaps" | "metrics">>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function timestamp(): string {
  return new Date().toISOString();
}

function emptyMetrics(): ProviderMetrics {
  return {
    llmCalls: 0,
    llmRetryCount: 0,
    llmTokens: null,
    tavilySearchCount: 0,
    tavilyCreditEstimate: null,
    gdeltSearchCount: 0,
    marketDataCalls: 0,
    providerErrors: 0,
    cost: "DATA NOT AVAILABLE"
  };
}

function publicRun(row: SqlRow): ResearchRun {
  return {
    id: String(row.id),
    query: String(row.query),
    exchange: String(row.exchange) as Exchange,
    status: String(row.status) as RunStatus,
    stage: String(row.stage) as Stage,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    iterationCount: Number(row.iteration_count),
    initialScore: row.initial_score === null ? null : Number(row.initial_score),
    finalScore: row.final_score === null ? null : Number(row.final_score),
    sourcesChecked: Number(row.sources_checked),
    primarySources: Number(row.primary_sources),
    secondarySources: Number(row.secondary_sources),
    criticalGapsFound: Number(row.critical_gaps_found),
    criticalGapsResolved: Number(row.critical_gaps_resolved),
    unresolvedGaps: Number(row.unresolved_gaps),
    gaps: parseJson<string[]>(row.gaps_json, []),
    metrics: parseJson<ProviderMetrics>(row.metrics_json, emptyMetrics()),
    plan: null,
    analysis: null,
    critique: null,
    report: null,
    iterations: [],
    sources: [],
    evidence: [],
    trace: []
  };
}

export class ResearchStore {
  readonly db: DatabaseSync;

  constructor(databasePath: string, cwd = process.cwd()) {
    const resolved = resolveDatabasePath(databasePath, cwd);
    if (resolved !== ":memory:") mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;");
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS research_runs (",
      " id TEXT PRIMARY KEY, query TEXT NOT NULL, exchange TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,",
      " created_at TEXT NOT NULL, updated_at TEXT NOT NULL, iteration_count INTEGER NOT NULL DEFAULT 0,",
      " initial_score INTEGER, final_score INTEGER, sources_checked INTEGER NOT NULL DEFAULT 0,",
      " primary_sources INTEGER NOT NULL DEFAULT 0, secondary_sources INTEGER NOT NULL DEFAULT 0,",
      " critical_gaps_found INTEGER NOT NULL DEFAULT 0, critical_gaps_resolved INTEGER NOT NULL DEFAULT 0,",
      " unresolved_gaps INTEGER NOT NULL DEFAULT 0, gaps_json TEXT NOT NULL DEFAULT '[]', metrics_json TEXT NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS run_state (run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,",
      " plan_json TEXT, analysis_json TEXT, critique_json TEXT, report_json TEXT, updated_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS research_questions (run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " question_id TEXT NOT NULL, question_json TEXT NOT NULL, PRIMARY KEY(run_id, question_id));",
      "CREATE TABLE IF NOT EXISTS iterations (run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " iteration INTEGER NOT NULL, search_tasks INTEGER NOT NULL, sources_added INTEGER NOT NULL, sources_checked INTEGER NOT NULL,",
      " primary_sources INTEGER NOT NULL, secondary_sources INTEGER NOT NULL, score INTEGER, critical_gaps_json TEXT NOT NULL,",
      " retry_required INTEGER NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id, iteration));",
      "CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " canonical_url TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, snippet TEXT NOT NULL, publisher TEXT NOT NULL,",
      " domain TEXT NOT NULL, provider TEXT NOT NULL, source_type TEXT NOT NULL, publication_date TEXT, retrieved_at TEXT NOT NULL,",
      " query TEXT NOT NULL, iteration INTEGER NOT NULL, UNIQUE(run_id, canonical_url));",
      "CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " claim_key TEXT NOT NULL, question_ids_json TEXT NOT NULL, claim TEXT NOT NULL, kind TEXT NOT NULL, source_ids_json TEXT NOT NULL,",
      " source_type TEXT NOT NULL, publisher TEXT NOT NULL, publication_date TEXT, reporting_period TEXT, evidence_text TEXT NOT NULL,",
      " supports_json TEXT NOT NULL, contradicts_json TEXT NOT NULL, confidence INTEGER, freshness TEXT NOT NULL,",
      " source_count INTEGER NOT NULL, independent_evidence_count INTEGER NOT NULL, UNIQUE(run_id, claim_key));",
      "CREATE TABLE IF NOT EXISTS critiques (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " iteration INTEGER NOT NULL, score INTEGER NOT NULL, critique_json TEXT NOT NULL, created_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS final_reports (run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,",
      " report_json TEXT NOT NULL, created_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY, exchange TEXT NOT NULL, created_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS provider_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES research_runs(id) ON DELETE CASCADE,",
      " iteration INTEGER NOT NULL, stage TEXT NOT NULL, provider TEXT NOT NULL, duration_ms INTEGER NOT NULL,",
      " result TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,",
      " type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
      "CREATE INDEX IF NOT EXISTS idx_runs_updated ON research_runs(updated_at DESC);",
      "CREATE INDEX IF NOT EXISTS idx_sources_run ON sources(run_id);",
      "CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id);",
      "CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);"
    ].join("\n"));
  }

  createRun(query: string, exchange: Exchange): ResearchRun {
    const id = "run_" + randomUUID();
    const now = timestamp();
    this.db.prepare("INSERT INTO research_runs (id,query,exchange,status,stage,created_at,updated_at,metrics_json) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, query, exchange, "running", "plan", now, now, JSON.stringify(emptyMetrics()));
    this.db.prepare("INSERT INTO run_state (run_id,updated_at) VALUES (?,?)").run(id, now);
    this.appendEvent(id, { type: "run", status: "running", stage: "plan", at: now });
    return this.getRun(id)!;
  }

  patchRun(id: string, patch: RunPatch): void {
    const columns: string[] = [];
    const values: Array<string | number | null> = [];
    const mapping: Array<[keyof RunPatch, string]> = [
      ["status", "status"], ["stage", "stage"], ["iterationCount", "iteration_count"],
      ["initialScore", "initial_score"], ["finalScore", "final_score"], ["sourcesChecked", "sources_checked"],
      ["primarySources", "primary_sources"], ["secondarySources", "secondary_sources"],
      ["criticalGapsFound", "critical_gaps_found"], ["criticalGapsResolved", "critical_gaps_resolved"],
      ["unresolvedGaps", "unresolved_gaps"]
    ];
    for (const [key, column] of mapping) {
      const value = patch[key];
      if (value !== undefined) { columns.push(column + "=?"); values.push(value as string | number | null); }
    }
    if (patch.gaps !== undefined) { columns.push("gaps_json=?"); values.push(JSON.stringify(patch.gaps)); }
    if (patch.metrics !== undefined) { columns.push("metrics_json=?"); values.push(JSON.stringify(patch.metrics)); }
    columns.push("updated_at=?");
    values.push(timestamp(), id);
    this.db.prepare("UPDATE research_runs SET " + columns.join(",") + " WHERE id=?").run(...values);
  }

  savePlan(id: string, plan: ResearchPlan): void {
    const now = timestamp();
    this.db.prepare("UPDATE run_state SET plan_json=?,updated_at=? WHERE run_id=?").run(JSON.stringify(plan), now, id);
    const insert = this.db.prepare("INSERT OR REPLACE INTO research_questions (run_id,question_id,question_json) VALUES (?,?,?)");
    for (const question of plan.researchQuestions) insert.run(id, question.id, JSON.stringify(question));
  }

  saveAnalysis(id: string, analysis: Analysis): void {
    this.db.prepare("UPDATE run_state SET analysis_json=?,updated_at=? WHERE run_id=?").run(JSON.stringify(analysis), timestamp(), id);
  }

  saveCritique(id: string, iteration: number, critique: Critique): void {
    const now = timestamp();
    this.db.prepare("UPDATE run_state SET critique_json=?,updated_at=? WHERE run_id=?").run(JSON.stringify(critique), now, id);
    this.db.prepare("INSERT INTO critiques (run_id,iteration,score,critique_json,created_at) VALUES (?,?,?,?,?)")
      .run(id, iteration, critique.overallScore, JSON.stringify(critique), now);
  }

  saveReport(id: string, report: FinalReport): void {
    const now = timestamp();
    this.db.prepare("UPDATE run_state SET report_json=?,updated_at=? WHERE run_id=?").run(JSON.stringify(report), now, id);
    this.db.prepare("INSERT OR REPLACE INTO final_reports (run_id,report_json,created_at) VALUES (?,?,?)")
      .run(id, JSON.stringify(report), now);
  }

  addSources(runId: string, sources: SearchSource[]): SearchSource[] {
    const added: SearchSource[] = [];
    const insert = this.db.prepare("INSERT OR IGNORE INTO sources (id,run_id,canonical_url,url,title,snippet,publisher,domain,provider,source_type,publication_date,retrieved_at,query,iteration) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const source of sources) {
      const result = insert.run(source.id, runId, source.canonicalUrl, source.url, source.title, source.snippet, source.publisher,
        source.domain, source.provider, source.sourceType, source.publicationDate, source.retrievedAt, source.query, source.iteration);
      if (Number(result.changes) > 0) added.push(source);
    }
    return added;
  }

  addEvidence(runId: string, rows: EvidenceObject[]): void {
    const upsert = this.db.prepare("INSERT INTO evidence (id,run_id,claim_key,question_ids_json,claim,kind,source_ids_json,source_type,publisher,publication_date,reporting_period,evidence_text,supports_json,contradicts_json,confidence,freshness,source_count,independent_evidence_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,claim_key) DO UPDATE SET question_ids_json=excluded.question_ids_json,source_ids_json=excluded.source_ids_json,source_type=excluded.source_type,publisher=excluded.publisher,publication_date=CASE WHEN evidence.publication_date=excluded.publication_date THEN evidence.publication_date ELSE NULL END,evidence_text=CASE WHEN length(excluded.evidence_text)>length(evidence.evidence_text) THEN excluded.evidence_text ELSE evidence.evidence_text END,supports_json=excluded.supports_json,contradicts_json=excluded.contradicts_json,source_count=excluded.source_count,independent_evidence_count=excluded.independent_evidence_count");
    for (const row of rows) {
      const claimKey = createHash("sha256").update(row.claim.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + (row.reportingPeriod || "").toLowerCase()).digest("hex");
      const sources = row.sourceIds;
      const domains = new Set(sources.map((sourceId) => {
        const source = this.db.prepare("SELECT domain FROM sources WHERE id=? AND run_id=?").get(sourceId, runId) as SqlRow | undefined;
        return source ? String(source.domain) : "";
      }).filter(Boolean));
      const prior = this.db.prepare("SELECT id,source_ids_json,question_ids_json,supports_json,contradicts_json,source_type,publisher FROM evidence WHERE run_id=? AND claim_key=?").get(runId, claimKey) as SqlRow | undefined;
      const priorSources = parseJson<string[]>(prior?.source_ids_json, []);
      const priorQuestions = parseJson<string[]>(prior?.question_ids_json, []);
      const priorSupports = parseJson<string[]>(prior?.supports_json, []);
      const priorContradicts = parseJson<string[]>(prior?.contradicts_json, []);
      const mergedSources = [...new Set([...priorSources, ...sources])];
      const mergedQuestions = [...new Set([...priorQuestions, ...row.questionIds])];
      const sourceRows = mergedSources.map((sourceId) => this.db.prepare("SELECT domain,source_type,publisher,publication_date FROM sources WHERE id=? AND run_id=?").get(sourceId, runId) as SqlRow | undefined).filter(Boolean);
      const mergedDomains = new Set(sourceRows.map((source) => String(source!.domain)).filter(Boolean));
      const sourceType = sourceRows.some((source) => source!.source_type === "primary") ? "primary" : row.sourceType;
      const publishers = [...new Set(sourceRows.map((source) => String(source!.publisher)).filter(Boolean))];
      const dates = [...new Set(sourceRows.map((source) => String(source!.publication_date || "")).filter(Boolean))];
      const mergedId = prior ? String(prior.id) : row.id;
      upsert.run(mergedId, runId, claimKey, JSON.stringify(mergedQuestions), row.claim, row.kind, JSON.stringify(mergedSources),
        sourceType, publishers.join(", ") || row.publisher, dates.length === 1 ? dates[0]! : null, row.reportingPeriod,
        row.evidenceText, JSON.stringify([...new Set([...priorSupports, ...row.supports])]),
        JSON.stringify([...new Set([...priorContradicts, ...row.contradicts])]), null, row.freshness,
        mergedSources.length, mergedDomains.size || domains.size);
    }
  }

  saveIteration(runId: string, item: IterationSummary): void {
    this.db.prepare("INSERT OR REPLACE INTO iterations (run_id,iteration,search_tasks,sources_added,sources_checked,primary_sources,secondary_sources,score,critical_gaps_json,retry_required,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(runId, item.iteration, item.searchTasks, item.sourcesAdded, item.sourcesChecked, item.primarySources,
        item.secondarySources, item.score, JSON.stringify(item.criticalGaps), item.retryRequired ? 1 : 0, item.summary, item.createdAt);
  }

  logProvider(runId: string, iteration: number, stage: string, provider: string, durationMs: number, result: string, error: string | null): void {
    this.db.prepare("INSERT INTO provider_events (run_id,iteration,stage,provider,duration_ms,result,error,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(runId, iteration, stage, provider, durationMs, result, error, timestamp());
  }

  appendEvent(runId: string, payload: Record<string, unknown>): number {
    const now = timestamp();
    const result = this.db.prepare("INSERT INTO run_events (run_id,type,payload_json,created_at) VALUES (?,?,?,?)")
      .run(runId, String(payload.type || "progress"), JSON.stringify({ ...payload, at: payload.at || now }), now);
    this.db.prepare("UPDATE research_runs SET updated_at=? WHERE id=?").run(now, runId);
    return Number(result.lastInsertRowid);
  }

  eventsAfter(runId: string, afterId = 0): Array<{ id: number; payload: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT id,payload_json FROM run_events WHERE run_id=? AND id>? ORDER BY id")
      .all(runId, afterId) as SqlRow[];
    return rows.map((row) => ({ id: Number(row.id), payload: parseJson<Record<string, unknown>>(row.payload_json, {}) }));
  }

  listRuns(limit = 100): ResearchRun[] {
    const rows = this.db.prepare("SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?").all(limit) as SqlRow[];
    return rows.map(publicRun);
  }

  recoverInterruptedRuns(): string[] {
    const rows = this.db.prepare("SELECT * FROM research_runs WHERE status='running'").all() as SqlRow[];
    const recovered: string[] = [];
    for (const row of rows) {
      const run = publicRun(row);
      const reason = "The server restarted before this run finished. Automatic resume is not available.";
      const state = this.db.prepare("SELECT plan_json FROM run_state WHERE run_id=?").get(run.id) as SqlRow | undefined;
      const plan = parseJson<ResearchPlan | null>(state?.plan_json, null);
      this.saveReport(run.id, {
        status: "LIMITED",
        classification: { classification: "unknown", source: null, verifiedAt: null, confidence: null },
        executiveSummary: { text: "Research is limited. " + reason, evidenceIds: [] },
        whatHappened: [],
        verifiedEvidence: [],
        likelyDrivers: [],
        fundamentalContext: [],
        bullCase: [],
        bearCase: [],
        keyRisks: [],
        contradictoryEvidence: [],
        unknowns: plan?.researchQuestions.filter((question) => question.required || question.priority === "high").map((question) => question.question) ?? [reason],
        confidence: "NOT SCORED",
        qualityScore: null,
        limitations: [reason]
      });
      this.patchRun(run.id, {
        status: "limited",
        stage: "finalize",
        unresolvedGaps: Math.max(1, run.unresolvedGaps),
        gaps: [reason],
        metrics: run.metrics
      });
      this.appendEvent(run.id, {
        type: "stage", stage: "finalize", status: "limited", iteration: run.iterationCount,
        title: "Interrupted run marked limited", detail: reason
      });
      this.appendEvent(run.id, { type: "final", status: "limited", reportReady: true, metrics: run.metrics });
      recovered.push(run.id);
    }
    return recovered;
  }

  getRun(id: string): ResearchRun | null {
    const row = this.db.prepare("SELECT * FROM research_runs WHERE id=?").get(id) as SqlRow | undefined;
    if (!row) return null;
    const run = publicRun(row);
    const state = this.db.prepare("SELECT plan_json,analysis_json,critique_json,report_json FROM run_state WHERE run_id=?").get(id) as SqlRow | undefined;
    run.plan = parseJson<ResearchPlan | null>(state?.plan_json, null);
    run.analysis = parseJson<Analysis | null>(state?.analysis_json, null);
    run.critique = parseJson<Critique | null>(state?.critique_json, null);
    run.report = parseJson<FinalReport | null>(state?.report_json, null);
    run.iterations = (this.db.prepare("SELECT * FROM iterations WHERE run_id=? ORDER BY iteration").all(id) as SqlRow[]).map((item) => ({
      iteration: Number(item.iteration),
      searchTasks: Number(item.search_tasks),
      sourcesAdded: Number(item.sources_added),
      sourcesChecked: Number(item.sources_checked),
      primarySources: Number(item.primary_sources),
      secondarySources: Number(item.secondary_sources),
      score: item.score === null ? null : Number(item.score),
      criticalGaps: parseJson<string[]>(item.critical_gaps_json, []),
      retryRequired: Number(item.retry_required) === 1,
      summary: String(item.summary),
      createdAt: String(item.created_at)
    }));
    run.sources = (this.db.prepare("SELECT * FROM sources WHERE run_id=? ORDER BY retrieved_at,id").all(id) as SqlRow[]).map((item) => ({
      id: String(item.id), url: String(item.url), canonicalUrl: String(item.canonical_url), title: String(item.title),
      snippet: String(item.snippet), publisher: String(item.publisher), domain: String(item.domain), provider: String(item.provider),
      sourceType: String(item.source_type) as "primary" | "secondary",
      publicationDate: item.publication_date === null ? null : String(item.publication_date),
      retrievedAt: String(item.retrieved_at), query: String(item.query), iteration: Number(item.iteration)
    }));
    run.evidence = (this.db.prepare("SELECT * FROM evidence WHERE run_id=? ORDER BY id").all(id) as SqlRow[]).map((item) => ({
      id: String(item.id), questionIds: parseJson<string[]>(item.question_ids_json, []), claim: String(item.claim),
      kind: String(item.kind) as EvidenceObject["kind"], sourceIds: parseJson<string[]>(item.source_ids_json, []),
      sourceType: String(item.source_type) as "primary" | "secondary", publisher: String(item.publisher),
      publicationDate: item.publication_date === null ? null : String(item.publication_date),
      reportingPeriod: item.reporting_period === null ? null : String(item.reporting_period),
      evidenceText: String(item.evidence_text), confidence: null,
      freshness: String(item.freshness) as EvidenceObject["freshness"],
      supports: parseJson<string[]>(item.supports_json, []), contradicts: parseJson<string[]>(item.contradicts_json, []),
      sourceCount: Number(item.source_count), independentEvidenceCount: Number(item.independent_evidence_count)
    }));
    run.trace = this.eventsAfter(id).map((event) => event.payload).filter((event) => event.type === "stage" || event.type === "retry")
      .map((event) => ({
        stage: String(event.stage || ""),
        title: String(event.title || event.stage || ""),
        detail: String(event.detail || event.summary || event.status || ""),
        at: String(event.at || ""),
        status: String(event.status || "")
      }));
    return run;
  }

  addWatchlist(symbol: string, exchange: Exchange): void {
    this.db.prepare("INSERT OR IGNORE INTO watchlist (symbol,exchange,created_at) VALUES (?,?,?)").run(symbol, exchange, timestamp());
  }

  getWatchlist(): Array<{ symbol: string; exchange: Exchange; createdAt: string }> {
    return (this.db.prepare("SELECT symbol,exchange,created_at FROM watchlist ORDER BY created_at DESC").all() as SqlRow[])
      .map((row) => ({ symbol: String(row.symbol), exchange: String(row.exchange) as Exchange, createdAt: String(row.created_at) }));
  }

  removeWatchlist(symbol: string): boolean {
    return Number(this.db.prepare("DELETE FROM watchlist WHERE symbol=?").run(symbol).changes) > 0;
  }

  health(): boolean {
    return Number((this.db.prepare("SELECT 1 AS healthy").get() as SqlRow).healthy) === 1;
  }

  close(): void {
    this.db.close();
  }
}

export function defaultProviderMetrics(): ProviderMetrics {
  return emptyMetrics();
}
