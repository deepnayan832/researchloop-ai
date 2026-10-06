const MAX_ITERATIONS = 4;
const PASS_SCORE = 85;

function makeDemoRun(id, label, query, exchange) {
  return {
    id: id,
    label: label,
    isDemo: true,
    query: query,
    exchange: exchange,
    status: 'demo',
    stage: 'finalize',
    createdAt: null,
    iterationCount: 1,
    trace: [
    { stage: 'plan', title: 'Plan prepared', detail: 'Example research questions organized.' },
    { stage: 'research', title: 'Research unavailable', detail: 'No exchange or company source was checked in this example.' },
    { stage: 'critique', title: 'Critical gap identified', detail: 'Source access is required to verify claims.' },
    { stage: 'finalize', title: 'Finalized with limitations', detail: 'No evidence or confidence score is available.' }
    ],
    sourcesChecked: 0,
    primarySources: 0,
    secondarySources: 0,
    criticalGapsFound: 1,
    criticalGapsResolved: 0,
    unresolvedGaps: 1,
    confidence: null
  };
}

const DEMO_RUNS = [
  makeDemoRun('sample-price-move', 'Price move example', 'Example: verify a one-day price move and search for a disclosed catalyst.', 'NSE'),
  makeDemoRun('sample-fundamentals', 'Fundamentals example', 'Example: review quarterly results, cash flow, debt, and margin risks.', 'BSE'),
  makeDemoRun('sample-classification', 'Classification example', 'Example: confirm small-cap classification and recent exchange filings.', 'NSE / BSE')
];
const DEMO_RUN = DEMO_RUNS[0];

const state = {
  activeView: 'overview',
  runs: [],
  watchlist: [],
  providerHealth: {},
  backendAvailable: false,
  selectedRunId: null,
  selectedRunDetail: null,
  isRunning: false,
  toastTimer: null,
  eventSource: null
};

const content = document.getElementById('app-content');
const topbarTitle = document.getElementById('topbar-title');
const toastNode = document.getElementById('toast');
const sidebar = document.getElementById('sidebar');
const mobileMenu = document.getElementById('mobile-menu');
const backdrop = document.getElementById('mobile-backdrop');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name) {
  const paths = {
    arrow: '<path d="M4 12h15M13 5l7 7-7 7"/>',
    back: '<path d="m14.5 5-7 7 7 7M8 12h12"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    file: '<path d="M7 3h8l4 4v14H5V3h2Z"/><path d="M14 3v5h5M8 13h8M8 17h8"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2"/>',
    chart: '<path d="M4 19V12M10 19V7M16 19V4M22 19v-9"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    alert: '<path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
}

function getAllRuns() {
  return DEMO_RUNS.concat(state.runs);
}

function getRun(id) {
  const demo = DEMO_RUNS.find(function (run) { return run.id === id; });
  if (demo) return demo;
  if (!id) return DEMO_RUN;
  if (state.selectedRunDetail && state.selectedRunDetail.id === id) return state.selectedRunDetail;
  return state.runs.find(function (run) { return run.id === id; }) || DEMO_RUN;
}

function getLatestRun() {
  return state.runs.length ? state.runs[0] : DEMO_RUN;
}

function displayDate(run) {
  if (run.isDemo) return 'Example';
  if (!run.createdAt) return 'Date unavailable';
  const date = new Date(run.createdAt);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function displayTime(run) {
  if (run.isDemo) return 'Demo data';
  if (!run.createdAt) return 'Time unavailable';
  return new Date(run.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function statusText(run) {
  if (run.isDemo) return 'Demo only';
  if (run.status === 'running') return 'Running';
  if (run.status === 'limited') return 'Limited';
  if (run.status === 'failed') return 'Failed';
  if (run.status === 'completed') return 'Completed';
  return 'Unknown';
}

function statusClass(run) {
  if (run.isDemo) return 'status-demo';
  if (run.status === 'running') return 'status-running';
  if (run.status === 'completed') return 'status-completed';
  if (run.status === 'failed') return 'status-failed';
  return 'status-limited';
}

function showToast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('is-visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(function () { toastNode.classList.remove('is-visible'); }, 3400);
}

function closeMobileNav() {
  sidebar.classList.remove('is-open');
  backdrop.classList.remove('is-visible');
  mobileMenu.setAttribute('aria-expanded', 'false');
}

function setView(view) {
  state.activeView = view;
  closeMobileNav();
  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function stepIndex(run) {
  const stage = run.stage || 'finalize';
  if (stage === 'evidence' || stage === 'analysis' || stage === 'retry') return 1;
  const stages = ['plan', 'research', 'critique', 'finalize'];
  return Math.max(0, stages.indexOf(stage));
}

function renderProcess(run) {
  const labels = [
    ['Plan', 'Interpret query and define scope'],
    ['Research', 'Find and analyze evidence'],
    ['Critique', 'Stress test and identify gaps'],
    ['Finalize', 'Synthesize with limitations']
  ];
  const active = stepIndex(run);
  return '<div class="process-panel"><div class="process-track">' + labels.map(function (item, index) {
    const className = index < active ? 'is-done' : index === active ? 'is-active' : '';
    const marker = index < active ? icon('check') : String(index + 1);
    return '<div class="process-step ' + className + '"><div class="step-marker">' + marker + '</div><div class="step-title">' + item[0] + '</div><div class="step-note">' + item[1] + '</div></div>';
  }).join('') + '</div></div>';
}

function timelineMarkup(run) {
  const stages = [
    { key: 'plan', title: 'Plan', matches: ['plan'], fallback: 'Waiting for the planner.' },
    { key: 'research', title: 'Research', matches: ['research', 'evidence', 'analysis', 'retry'], fallback: 'Waiting for evidence retrieval.' },
    { key: 'critique', title: 'Critique', matches: ['critique'], fallback: 'Waiting for the critic.' },
    { key: 'finalize', title: 'Finalize', matches: ['finalize'], fallback: 'Waiting for the quality gate.' }
  ];
  const current = stepIndex(run);
  return '<ol class="timeline">' + stages.map(function (item, index) {
    const traceItem = (run.trace || []).slice().reverse().find(function (entry) { return item.matches.includes(entry.stage); });
    const isDone = traceItem && ['completed', 'limited', 'skipped'].includes(traceItem.status);
    const done = run.isDemo ? run.status !== 'running' : Boolean(isDone || (run.status === 'running' && index < current));
    const active = run.status === 'running' && index === current;
    const nodeClass = done ? 'done' : active ? 'current' : '';
    const mark = done ? icon('check') : '';
    const detail = traceItem ? traceItem.detail : item.fallback;
    const title = traceItem && traceItem.title ? traceItem.title : item.title;
    return '<li class="timeline-item"><span class="timeline-node ' + nodeClass + '">' + mark + '</span><div class="timeline-copy"><strong>' + escapeHtml(title) + (run.status === 'running' && active ? ' in progress' : '') + '</strong><span>' + escapeHtml(detail) + '</span></div><span class="timeline-time">' + (traceItem ? (run.isDemo ? 'Example' : 'Logged') : '') + '</span></li>';
  }).join('') + '</ol>';
}

function runRow(run) {
  const id = escapeHtml(run.id);
  const query = escapeHtml(run.query);
  const exchange = escapeHtml(run.exchange || 'NSE / BSE');
  return '<tr><td><button class="table-open" type="button" data-open-report="' + id + '">' + (run.isDemo ? escapeHtml(run.label) : 'Research request') + '</button><span class="company-symbol">' + exchange + (run.isDemo ? ' · sample' : '') + '</span></td><td class="question-cell">' + query + '</td><td><span class="status-chip ' + statusClass(run) + '">' + statusText(run) + '</span></td><td class="date-cell">' + displayDate(run) + '</td><td><button class="row-more" type="button" aria-label="Open report" data-open-report="' + id + '">' + icon('arrow') + '</button></td></tr>';
}

function renderRunTable(runs, showFooter) {
  const rows = runs.map(runRow).join('');
  const empty = '<tr><td class="table-empty" colspan="5">No research runs match this view.</td></tr>';
  return '<div class="table-scroll"><table class="data-table run-table"><thead><tr><th>Research item</th><th>Research question</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' + (rows || empty) + '</tbody></table></div>' + (showFooter ? '<div class="panel-table-foot"><span>Examples and server-saved runs</span><span>' + runs.length + ' item' + (runs.length === 1 ? '' : 's') + '</span></div>' : '');
}

function renderNotice(compact, run) {
  const isDemo = !run || run.isDemo;
  const title = isDemo ? 'Demo report · No live exchange data connected' : (run.status === 'completed' ? 'Source-backed report · Review evidence and limitations' : 'Limited report · Evidence or provider gaps remain');
  const detail = isDemo
    ? 'This example did not check exchange filings, company disclosures, market prices, or financial statements. It is not investment advice.'
    : 'Current data can be incomplete or delayed. Open each cited source and review the quality gate before relying on a claim. This is not investment advice.';
  return '<div class="demo-notice ' + (compact ? 'compact' : '') + '">' + icon('info') + '<div><strong>' + title + '</strong><p>' + detail + '</p></div></div>';
}

function renderOverview() {
  const latest = getLatestRun();
  const runs = getAllRuns();
  const buttonText = state.isRunning ? 'Researching…' : 'Start research';
  const disabled = state.isRunning ? ' disabled' : '';
  return '<section class="query-section"><h1>Start a research loop</h1><form id="research-form" class="query-form">' +
    '<label class="query-control"><span class="sr-only">Research question</span>' + icon('search') + '<textarea id="research-query" name="query" minlength="12" required placeholder="Ask about a company, market move, or fundamental trend…"></textarea></label>' +
    '<label class="query-select-wrap"><span class="sr-only">Exchange</span><select class="query-select" name="exchange"><option value="NSE">NSE</option><option value="BSE">BSE</option><option value="NSE / BSE">NSE / BSE</option></select></label>' +
    '<button class="button button-primary" type="submit"' + disabled + '>' + buttonText + icon('arrow') + '</button></form>' +
    '<div class="query-footnote"><span>' + (state.backendAvailable ? 'Runs and watchlist are saved in SQLite. Provider availability is shown in Settings.' : 'Backend is unavailable. Start the local server to run research.') + '</span><span class="query-error" id="query-error" aria-live="polite"></span></div></section>' +
    renderProcess(latest) +
    '<section class="overview-grid"><div class="panel"><div class="panel-head"><h2 class="section-title">Recent research runs</h2><button class="button button-quiet" type="button" data-view="runs">View all runs ' + icon('arrow') + '</button></div>' + renderRunTable(runs.slice(0, 4), true) + '</div>' +
    '<aside class="panel run-panel"><div class="panel-head"><h2 class="section-title">Latest run</h2><span class="panel-head-meta">' + (latest.isDemo ? 'Example' : displayDate(latest)) + '</span></div><div class="panel-content">' +
    '<div class="run-detail-head"><div><strong>' + (latest.isDemo ? escapeHtml(latest.label) : 'Research request') + '</strong><span>' + escapeHtml(latest.exchange || 'NSE / BSE') + ' · ' + statusText(latest) + '</span></div><span class="run-detail-date">' + (latest.isDemo ? 'No live data' : displayTime(latest)) + '</span></div>' +
    '<p class="run-question">' + escapeHtml(latest.query) + '</p><div class="iteration-label"><span>Iteration ' + (latest.iterationCount == null ? 1 : latest.iterationCount) + ' of ' + MAX_ITERATIONS + '</span><span>' + (latest.status === 'running' ? 'Research in progress' : latest.isDemo ? 'Example only' : String(latest.status).toUpperCase()) + '</span></div>' +
    timelineMarkup(latest) + '<button class="button button-primary panel-full-button" type="button" data-open-report="' + escapeHtml(latest.id) + '">Open report ' + icon('arrow') + '</button></div></aside></section>';
}

function renderRunsPage() {
  const runs = getAllRuns();
  return '<div class="page-head"><div><h1>Research runs</h1><p>Review server-saved research requests, source counts, quality scores, and run traces.</p></div><button class="button button-primary" type="button" data-new-research>' + icon('plus') + ' New research</button></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Server-saved research runs</strong><p>Examples are marked as demo. Live runs show their provider gaps, source records, and status.</p></div></div>' +
    '<section class="panel list-panel"><div class="list-toolbar"><div class="toolbar"><label class="search-control">' + icon('search') + '<span class="sr-only">Search runs</span><input type="search" id="run-search" placeholder="Search research questions" /></label><select class="filter-select" id="run-filter" aria-label="Filter runs"><option value="all">All runs</option><option value="completed">Completed</option><option value="limited">Limited</option><option value="failed">Failed</option><option value="demo">Demo only</option></select></div><span class="result-count" id="run-result-count">' + runs.length + ' items</span></div><div id="runs-table">' + renderRunTable(runs, false) + '</div></section>';
}

function renderReportsPage() {
  const reports = getAllRuns().filter(function (run) { return run.isDemo || run.status !== 'running'; });
  return '<div class="page-head"><div><h1>Reports</h1><p>Final research summaries with evidence status, gaps, and run details.</p></div><button class="button button-secondary" type="button" data-export-list>' + icon('download') + ' Export run list</button></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Evidence status is explicit</strong><p>Each server report shows its actual run status, source records, citations, and unresolved gaps. Demo examples remain clearly marked.</p></div></div>' +
    '<section class="panel list-panel"><div class="panel-head"><h2 class="section-title">Available reports</h2><span class="panel-head-meta">' + reports.length + ' report' + (reports.length === 1 ? '' : 's') + '</span></div>' + renderRunTable(reports, true) + '</section>';
}

function renderWatchlist() {
  const rows = state.watchlist.map(function (item, index) {
    return '<tr><td><span class="watchlist-symbol">' + escapeHtml(item.symbol) + '</span></td><td>' + escapeHtml(item.exchange) + '</td><td><span class="status-chip status-demo">Listing not verified</span></td><td><button class="button button-quiet" type="button" data-remove-watch="' + index + '">Remove</button></td></tr>';
  }).join('');
  const table = state.watchlist.length ? '<div class="table-scroll"><table class="data-table watchlist-table"><thead><tr><th>Symbol</th><th>Exchange</th><th>Listing status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="panel-empty-state watchlist-empty"><span class="empty-icon">' + icon('chart') + '</span><strong>Your watchlist is empty</strong><p>Add a symbol to save it in the server database. Exchange listing and market data are not implied.</p></div>';
  return '<div class="page-head"><div><h1>Watchlist</h1><p>Keep research targets in one place. Market data requires a live source connection.</p></div><form class="watchlist-form" id="watchlist-form"><label class="sr-only" for="watch-symbol">Company symbol</label><input id="watch-symbol" name="symbol" maxlength="20" placeholder="Add NSE / BSE symbol" required /><button class="button button-primary" type="submit">' + icon('plus') + ' Add symbol</button></form></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Watchlist is server-saved</strong><p>Symbols persist in SQLite. Adding a symbol does not verify that it is listed on NSE or BSE.</p></div></div>' +
    '<section class="panel list-panel"><div class="panel-head"><h2 class="section-title">Saved symbols</h2><span class="panel-head-meta">' + state.watchlist.length + ' item' + (state.watchlist.length === 1 ? '' : 's') + '</span></div>' + table + '</section>';
}

function providerRow(title, key) {
  const provider = state.providerHealth[key];
  const status = typeof provider === 'string' ? provider : state.backendAvailable ? 'missing' : 'error';
  const detail = state.providerHealth[key + '_detail'] || (state.backendAvailable ? 'Provider state is unavailable.' : 'Research backend is unavailable.');
  const className = status === 'configured' || status === 'available' || status === 'healthy' ? 'status-completed' : 'status-limited';
  return '<div class="config-row"><div class="config-copy"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(detail) + '</span></div><span class="status-chip ' + className + '">' + escapeHtml(status) + '</span></div>';
}

function renderSettings() {
  return '<div class="page-head"><div><h1>Settings</h1><p>Research policy and source priorities from the ResearchLoop prompt.</p></div></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Server-side provider status</strong><p>Secrets remain in the server environment. Configure providers in .env and restart the server; this page never displays API keys.</p></div></div>' +
    '<div class="config-grid"><section class="panel"><div class="panel-head"><h2 class="section-title">Loop controls</h2></div><div class="config-row"><div class="config-copy"><strong>Maximum iterations</strong><span>Stop after this many plan, research, critique, and retry cycles.</span></div><span class="config-value">' + MAX_ITERATIONS + '</span></div><div class="config-row"><div class="config-copy"><strong>Minimum pass score</strong><span>Finalize with limitations if the report does not meet this threshold.</span></div><span class="config-value">' + PASS_SCORE + ' / 100</span></div><div class="config-row"><div class="config-copy"><strong>Retry approach</strong><span>Research only unresolved gaps when meaningful new evidence may be found.</span></div><span class="config-value">Targeted</span></div></section>' +
    '<section class="panel"><div class="panel-head"><h2 class="section-title">Provider health</h2><span class="panel-head-meta">' + (state.backendAvailable ? 'Server connected' : 'Server unavailable') + '</span></div>' +
    providerRow('OpenAI-compatible LLM', 'llm') + providerRow('Tavily web search', 'tavily') + providerRow('GDELT news discovery', 'gdelt') + providerRow('India market data adapter', 'market_data') + providerRow('SQLite database', 'database') +
    '<div class="config-row"><div class="config-copy"><strong>Source priority</strong><span>Official exchanges and regulators are marked primary by domain; news and market vendor data remain secondary.</span><div class="tier-list"><span>Exchange filings</span><span>Regulators</span><span>Company disclosures</span><span>Financial news</span></div></div></div></section></div>';
}

function reportTrace(run) {
  return timelineMarkup(run);
}

function reportSummary(run) {
  const metrics = run.metrics || {};
  const values = [
    ['run_id', run.id],
    ['iterations', run.iterationCount == null ? 0 : run.iterationCount],
    ['initial_score', run.initialScore == null ? 'DATA NOT AVAILABLE' : run.initialScore + ' / 100'],
    ['final_score', run.finalScore == null ? 'DATA NOT AVAILABLE' : run.finalScore + ' / 100'],
    ['sources_checked', run.sourcesChecked == null ? 0 : run.sourcesChecked],
    ['primary_sources', run.primarySources == null ? 0 : run.primarySources],
    ['secondary_sources', run.secondarySources == null ? 0 : run.secondarySources],
    ['critical_gaps_found', run.criticalGapsFound == null ? 0 : run.criticalGapsFound],
    ['critical_gaps_resolved', run.criticalGapsResolved == null ? 0 : run.criticalGapsResolved],
    ['unresolved_gaps', run.unresolvedGaps == null ? 0 : run.unresolvedGaps],
    ['llm_calls', metrics.llmCalls == null ? 0 : metrics.llmCalls],
    ['llm_json_repairs', metrics.llmRetryCount == null ? 0 : metrics.llmRetryCount],
    ['tavily_searches', metrics.tavilySearchCount == null ? 0 : metrics.tavilySearchCount],
    ['tavily_credit_estimate', metrics.tavilyCreditEstimate == null ? 'DATA NOT AVAILABLE' : metrics.tavilyCreditEstimate],
    ['market_data_calls', metrics.marketDataCalls == null ? 0 : metrics.marketDataCalls],
    ['provider_errors', metrics.providerErrors == null ? 0 : metrics.providerErrors],
    ['cost', 'DATA NOT AVAILABLE'],
    ['status', run.isDemo ? 'DEMO' : String(run.status || 'unknown').toUpperCase()]
  ];
  return '<div class="run-summary"><h3>Run summary</h3><div class="summary-grid">' + values.map(function (item) { return '<span>' + item[0] + '</span><strong>' + escapeHtml(item[1]) + '</strong>'; }).join('') + '</div></div>';
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (error) {
    return null;
  }
}

function citationLinks(evidenceIds, run) {
  const sourceIds = new Set();
  (run.evidence || []).forEach(function (evidence) {
    if ((evidenceIds || []).includes(evidence.id)) (evidence.sourceIds || []).forEach(function (id) { sourceIds.add(id); });
  });
  return (run.sources || []).filter(function (source) { return sourceIds.has(source.id); }).map(function (source) {
    const href = safeSourceUrl(source.url);
    return href ? '<a class="citation-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.title || source.publisher || 'Source') + '</a>' : '';
  }).filter(Boolean).join(' ');
}

function claimSection(title, claims, run) {
  const items = (claims || []).filter(function (claim) { return claim && claim.text; });
  const body = items.length ? items.map(function (claim) {
    const citations = citationLinks(claim.evidenceIds, run);
    return '<p class="report-claim">' + escapeHtml(claim.text) + (citations ? '<span class="claim-citations">' + citations + '</span>' : '') + '</p>';
  }).join('') : '<p>DATA NOT AVAILABLE.</p>';
  return '<section class="report-section"><h3>' + escapeHtml(title) + '</h3>' + body + '</section>';
}

function renderEvidenceTable(run) {
  const rows = (run.evidence || []).map(function (item) {
    const urls = citationLinks([item.id], run);
    const question = escapeHtml((item.questionIds || []).join(', ') || '—');
    const source = urls || escapeHtml(item.publisher || 'Not linked');
    const date = item.publicationDate ? escapeHtml(new Date(item.publicationDate).toLocaleDateString('en-CA')) : 'DATA NOT AVAILABLE';
    return '<tr><td>' + question + '</td><td><strong>' + escapeHtml(item.kind) + '</strong><br />' + escapeHtml(item.claim) + '</td><td>' + source + '</td><td>' + date + '</td><td>NOT SCORED</td></tr>';
  }).join('');
  const empty = '<tr><td class="table-empty" colspan="5">No evidence was extracted from retrieved sources.</td></tr>';
  return '<div class="report-table"><div class="table-scroll"><table class="data-table"><thead><tr><th>Questions</th><th>Evidence claim</th><th>Source</th><th>Published</th><th>Confidence</th></tr></thead><tbody>' + (rows || empty) + '</tbody></table></div></div>';
}

function renderSourceTable(run) {
  const rows = (run.sources || []).map(function (source) {
    const href = safeSourceUrl(source.url);
    const link = href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.title || source.domain) + '</a>' : escapeHtml(source.title);
    const date = source.publicationDate ? escapeHtml(new Date(source.publicationDate).toLocaleDateString('en-CA')) : 'DATA NOT AVAILABLE';
    const questionIds = (run.evidence || []).filter(function (item) { return (item.sourceIds || []).includes(source.id); })
      .flatMap(function (item) { return item.questionIds || []; });
    const questions = Array.from(new Set(questionIds)).join(', ') || '—';
    return '<tr><td>' + link + '</td><td>' + escapeHtml(source.sourceType.toUpperCase()) + '</td><td>' + escapeHtml(source.publisher) + '</td><td>' + date + '</td><td>' + escapeHtml(questions) + '</td><td>NOT SCORED</td></tr>';
  }).join('');
  const empty = '<tr><td class="table-empty" colspan="6">No sources were checked.</td></tr>';
  return '<div class="report-table"><div class="table-scroll"><table class="data-table"><thead><tr><th>Source</th><th>Type</th><th>Publisher</th><th>Published</th><th>Used for</th><th>Confidence</th></tr></thead><tbody>' + (rows || empty) + '</tbody></table></div></div>';
}

function renderIterationHistory(run) {
  const iterations = run.iterations || [];
  if (!iterations.length) return '<p>' + (run.isDemo ? 'This bundled example does not represent a real research iteration.' : 'No research iteration was run.') + '</p>';
  return iterations.map(function (item) {
    const gaps = (item.criticalGaps || []).length
      ? '<ul class="unknown-list">' + item.criticalGaps.map(function (gap) { return '<li>' + escapeHtml(gap) + '</li>'; }).join('') + '</ul>'
      : '<p>No unresolved gaps were recorded for this iteration.</p>';
    return '<div class="iteration-card"><strong>Iteration ' + item.iteration + ' of ' + MAX_ITERATIONS + '</strong><p>' +
      item.searchTasks + ' search task(s) · ' + item.sourcesAdded + ' new source(s) · ' + item.sourcesChecked + ' total · ' +
      item.primarySources + ' primary · ' + item.secondarySources + ' secondary · score ' +
      (item.score == null ? 'DATA NOT AVAILABLE' : escapeHtml(item.score + ' / 100')) + '</p>' + gaps + '</div>';
  }).join('');
}

function classificationSection(value) {
  const classification = value || { classification: 'unknown', source: null, verifiedAt: null, confidence: null };
  const href = classification.source ? safeSourceUrl(classification.source) : null;
  const source = href
    ? '<a class="citation-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">Open verified source</a>'
    : 'DATA NOT AVAILABLE';
  const verifiedAt = classification.verifiedAt
    ? escapeHtml(new Date(classification.verifiedAt).toLocaleString('en-IN'))
    : 'NOT VERIFIED';
  return '<section class="report-section"><h3>Company classification</h3><div class="summary-grid"><span>Classification</span><strong>' +
    escapeHtml(classification.classification || 'unknown') + '</strong><span>Source</span><strong>' + source +
    '</strong><span>Verified at</span><strong>' + verifiedAt + '</strong><span>Confidence</span><strong>' +
    (classification.confidence == null ? 'NOT SCORED' : escapeHtml(classification.confidence + ' / 100')) + '</strong></div></section>';
}

function renderReport(run) {
  const query = escapeHtml(run.query);
  const exchange = escapeHtml(run.exchange || 'NSE / BSE');
  const report = run.report || (run.isDemo ? {
    status: 'LIMITED',
    classification: { classification: 'unknown', source: null, verifiedAt: null, confidence: null },
    executiveSummary: { text: 'No live research was performed for this bundled example. Exchange filings, company disclosures, market prices, financial statements, and current small-cap classification were not checked.', evidenceIds: [] },
    whatHappened: [],
    verifiedEvidence: [],
    likelyDrivers: [],
    fundamentalContext: [],
    bullCase: [],
    bearCase: [],
    keyRisks: [],
    contradictoryEvidence: [],
    unknowns: [
      'Whether the security is currently classified as small-cap.',
      'What exchange filings or company announcements were published.',
      'Whether the requested market move occurred and at what volume.',
      'Whether the latest fundamental data changes the analysis.'
    ],
    confidence: 'NOT SCORED',
    qualityScore: null,
    limitations: ['Bundled example only; no provider calls or source checks occurred.']
  } : null);
  const unknowns = report ? report.unknowns || [] : run.gaps || [];
  const score = report && report.qualityScore != null ? report.qualityScore : run.finalScore;
  const summary = report && report.executiveSummary ? report.executiveSummary.text : run.status === 'running' ? 'Research is running. Follow the live stage trace for progress.' : 'No final report is available for this run.';
  const statusLabel = run.isDemo ? 'Demo only' : String(run.status || 'unknown').toUpperCase();
  const statusCss = statusClass(run);
  const finalClaims = report || {};
  const unknownMarkup = unknowns.length
    ? unknowns.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('')
    : '<li>No unresolved questions were recorded.</li>';
  const iterationCount = run.iterationCount == null ? 0 : run.iterationCount;
  const reportNotice = renderNotice(true, run);
  const evidenceSection = '<section class="report-section"><h3>Verified evidence</h3><p>Evidence is shown as extracted from retrieved sources. Confidence values are not independently scored.</p>' + renderEvidenceTable(run) + '</section>' +
    '<section class="report-section"><h3>Sources</h3><p>Primary labels are assigned only to recognized official exchange, regulator, and government domains. News and vendor feeds remain secondary.</p>' + renderSourceTable(run) + '</section>';
  const analysisSections = [
    claimSection('What happened', finalClaims.whatHappened, run),
    claimSection('Likely drivers', finalClaims.likelyDrivers, run),
    claimSection('Fundamental context', finalClaims.fundamentalContext, run),
    claimSection('Bull case', finalClaims.bullCase, run),
    claimSection('Bear case', finalClaims.bearCase, run),
    claimSection('Key risks', finalClaims.keyRisks, run),
    claimSection('Contradictory evidence', finalClaims.contradictoryEvidence, run)
  ].join('');
  const limitations = (report && report.limitations || []).map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
  const limitationBlock = limitations ? '<div class="unknown-block"><h3>Limitations</h3><ul class="unknown-list">' + limitations + '</ul></div>' : '';
  return '<div class="report-top"><button class="back-link" type="button" data-view="runs">' + icon('back') + ' Research runs</button><h1>Company research report</h1>' + reportNotice +
    '<div class="report-identity"><div><h2>' + (run.isDemo ? escapeHtml(run.label) : 'Research request') + '</h2><span class="report-symbol">' + exchange + ' · ' + (run.isDemo ? 'Example' : escapeHtml(run.id)) + '</span></div><span class="status-chip ' + statusCss + '">' + escapeHtml(statusLabel) + '</span><div class="report-meta"><span><strong>Research question</strong>' + query + '</span>' + (!run.isDemo ? '<button class="button button-secondary" type="button" data-export="' + escapeHtml(run.id) + '">' + icon('download') + ' Export report</button>' : '') + '</div></div></div>' +
    '<div class="report-layout"><article class="panel report-main">' +
    '<section class="report-section"><div class="report-summary-grid"><div><h3>Executive summary</h3><p>' + escapeHtml(summary) + '</p></div><div class="confidence-block"><span class="confidence-value">' + (score == null ? 'DATA NOT AVAILABLE' : escapeHtml(score + ' / 100')) + '</span><span class="unavailable-pill">' + (run.isDemo ? 'Demo only' : 'Critic score') + '</span><span class="confidence-label">Evidence confidence is not independently scored.</span></div></div></section>' +
    classificationSection(report && report.classification) + evidenceSection + analysisSections +
    '<section class="report-section"><h3>Iteration history</h3>' + renderIterationHistory(run) + '</section></article>' +
    '<aside class="panel report-side"><h2 class="section-title">Research loop</h2><div class="iteration-label"><span>Iteration ' + iterationCount + ' of ' + MAX_ITERATIONS + '</span><span>' + escapeHtml(statusLabel) + '</span></div>' + reportTrace(run) +
    '<div class="unknown-block"><h3>What remains unknown</h3><ul class="unknown-list">' + unknownMarkup + '</ul></div>' + limitationBlock + reportSummary(run) +
    '<div class="report-action-row"><button class="button button-secondary" type="button" data-new-research>Start another query</button></div></aside></div>';
}

function renderApp() {
  document.querySelectorAll('.nav-item[data-view]').forEach(function (item) {
    item.classList.toggle('is-active', item.dataset.view === state.activeView);
  });
  document.getElementById('run-count').textContent = String(state.runs.length);
  if (state.activeView === 'report') {
    const run = getRun(state.selectedRunId);
    topbarTitle.textContent = 'Company research report';
    content.innerHTML = renderReport(run);
  } else {
    const titles = { overview: 'Research workspace', runs: 'Research runs', watchlist: 'Watchlist', reports: 'Reports', settings: 'Settings' };
    topbarTitle.textContent = titles[state.activeView] || 'Research workspace';
    if (state.activeView === 'runs') content.innerHTML = renderRunsPage();
    else if (state.activeView === 'reports') content.innerHTML = renderReportsPage();
    else if (state.activeView === 'watchlist') content.innerHTML = renderWatchlist();
    else if (state.activeView === 'settings') content.innerHTML = renderSettings();
    else content.innerHTML = renderOverview();
  }
}

async function apiRequest(url, options) {
  const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
  let body = {};
  try { body = await response.json(); } catch (error) { body = {}; }
  if (!response.ok) throw new Error(body.error || ('Request failed with HTTP ' + response.status + '.'));
  return body;
}

function replaceRun(run) {
  const index = state.runs.findIndex(function (item) { return item.id === run.id; });
  if (index < 0) state.runs.unshift(run);
  else state.runs[index] = Object.assign({}, state.runs[index], run);
}

async function refreshRunDetail(id) {
  const result = await apiRequest('/api/research/runs/' + encodeURIComponent(id));
  state.selectedRunDetail = result.run;
  replaceRun(result.run);
  renderApp();
  return result.run;
}

function handleRunEvent(runId, event) {
  const run = state.runs.find(function (item) { return item.id === runId; });
  if (!run || !event) return;
  if (event.type === 'stage') {
    run.stage = event.stage || run.stage;
    run.iterationCount = Math.max(run.iterationCount || 0, Number(event.iteration) || 0);
    run.trace = run.trace || [];
    run.trace.push({
      stage: event.stage || '',
      status: event.status || '',
      title: event.title || event.stage || '',
      detail: event.detail || '',
      at: event.at || new Date().toISOString()
    });
    if (typeof event.score === 'number') {
      run.finalScore = event.score;
      if (Number(event.iteration) === 1) run.initialScore = event.score;
      run.criticalGapsFound = Math.max(run.criticalGapsFound || 0, (event.criticalGaps || []).length);
      run.unresolvedGaps = (event.criticalGaps || []).length;
      run.gaps = event.criticalGaps || [];
    }
  } else if (event.type === 'final') {
    run.status = event.status || 'limited';
    run.stage = 'finalize';
    run.finalScore = event.score == null ? null : event.score;
    run.metrics = event.metrics || run.metrics;
    state.isRunning = state.runs.some(function (item) { return item.status === 'running'; });
  }
  renderApp();
}

function connectRunEvents(run) {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource('/api/research/runs/' + encodeURIComponent(run.id) + '/events');
  state.eventSource = source;
  source.onmessage = function (message) {
    let event;
    try { event = JSON.parse(message.data); } catch (error) { return; }
    handleRunEvent(run.id, event);
    if (event.type === 'final') {
      source.close();
      state.eventSource = null;
      refreshRunDetail(run.id).then(function () {
        state.isRunning = state.runs.some(function (item) { return item.status === 'running'; });
        setView('report');
        showToast('Run finished with status ' + String(event.status || 'unknown').toUpperCase() + '.');
      }).catch(function () {
        showToast('Run ended, but the saved report could not be loaded.');
      });
    }
  };
  source.onerror = function () {
    const current = state.runs.find(function (item) { return item.id === run.id; });
    if (current && current.status !== 'running') source.close();
  };
}

async function startResearch(query, exchange) {
  if (!state.backendAvailable) {
    showToast('Research backend is unavailable. Start npm run dev first.');
    return;
  }
  state.isRunning = true;
  renderApp();
  try {
    const result = await apiRequest('/api/research/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query, exchange: exchange })
    });
    const run = result.run;
    replaceRun(run);
    state.selectedRunId = run.id;
    state.selectedRunDetail = run;
    showToast('Research request accepted by the server.');
    renderApp();
    connectRunEvents(run);
  } catch (error) {
    state.isRunning = state.runs.some(function (item) { return item.status === 'running'; });
    renderApp();
    const errorNode = document.getElementById('query-error');
    if (errorNode) errorNode.textContent = error.message;
    showToast(error.message);
  }
}

function filterRunRows() {
  const search = document.getElementById('run-search');
  const filter = document.getElementById('run-filter');
  const table = document.getElementById('runs-table');
  if (!search || !filter || !table) return;
  const query = search.value.trim().toLowerCase();
  const status = filter.value;
  const body = table.querySelector('tbody');
  const previousEmpty = body.querySelector('.filter-empty');
  if (previousEmpty) previousEmpty.remove();
  let visible = 0;
  body.querySelectorAll('tr').forEach(function (row) {
    const rowText = row.textContent.toLowerCase();
    const isDemo = row.textContent.toLowerCase().includes('demo only');
    const isLimited = row.textContent.toLowerCase().includes('limited');
    const isCompleted = row.textContent.toLowerCase().includes('completed');
    const isFailed = row.textContent.toLowerCase().includes('failed');
    const matchStatus = status === 'all' || (status === 'demo' && isDemo) || (status === 'limited' && isLimited) ||
      (status === 'completed' && isCompleted) || (status === 'failed' && isFailed);
    const show = rowText.includes(query) && matchStatus;
    row.hidden = !show;
    if (show && !row.querySelector('.table-empty')) visible += 1;
  });
  if (visible === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'filter-empty';
    emptyRow.innerHTML = '<td class="table-empty" colspan="5">No research runs match these filters.</td>';
    body.appendChild(emptyRow);
  }
  const count = document.getElementById('run-result-count');
  if (count) count.textContent = visible + ' item' + (visible === 1 ? '' : 's');
}

function exportRun(run) {
  if (!run.isDemo) {
    fetch('/api/research/runs/' + encodeURIComponent(run.id) + '/export', { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Report export failed with HTTP ' + response.status + '.');
        return response.json();
      })
      .then(function (payload) {
        downloadFile('researchloop-' + run.id + '.json', JSON.stringify(payload, null, 2), 'application/json');
        showToast('Saved report JSON downloaded.');
      })
      .catch(function (error) { showToast(error.message); });
    return;
  }
  const summary = {
    run_id: run.id,
    query: run.query,
    iterations: run.iterationCount || 1,
    initial_score: null,
    final_score: null,
    sources_checked: run.sourcesChecked || 0,
    primary_sources: run.primarySources || 0,
    secondary_sources: run.secondarySources || 0,
    critical_gaps_found: run.criticalGapsFound || 1,
    critical_gaps_resolved: run.criticalGapsResolved || 0,
    unresolved_gaps: run.unresolvedGaps || 1,
    status: 'DEMO',
    note: 'This bundled example is not live research.'
  };
  const payload = { report_status: summary.status, run_summary: summary, trace: run.trace || [], sources: [], evidence: [] };
  downloadFile('researchloop-' + run.id + '.json', JSON.stringify(payload, null, 2), 'application/json');
}

async function openReport(id) {
  state.selectedRunId = id;
  const demo = DEMO_RUNS.find(function (run) { return run.id === id; });
  if (demo) {
    state.selectedRunDetail = demo;
    setView('report');
    return;
  }
  try {
    await refreshRunDetail(id);
    setView('report');
  } catch (error) {
    showToast(error.message);
  }
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('click', function (event) {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    event.preventDefault();
    setView(viewButton.dataset.view);
    return;
  }
  const openButton = event.target.closest('[data-open-report]');
  if (openButton) {
    openReport(openButton.dataset.openReport);
    return;
  }
  if (event.target.closest('[data-new-research]')) {
    setView('overview');
    window.requestAnimationFrame(function () { document.getElementById('research-query')?.focus(); });
    return;
  }
  if (event.target.closest('.workspace-button')) {
    showToast('This local workspace is served by the ResearchLoop backend.');
    return;
  }
  const exportButton = event.target.closest('[data-export]');
  if (exportButton) {
    exportRun(getRun(exportButton.dataset.export));
    return;
  }
  if (event.target.closest('[data-export-list]')) {
    const rows = getAllRuns().map(function (run) { return { id: run.id, query: run.query, status: statusText(run), updated: displayDate(run), sources_checked: run.sourcesChecked || 0 }; });
    downloadFile('researchloop-run-list.json', JSON.stringify(rows, null, 2), 'application/json');
    showToast('Run list downloaded as JSON.');
    return;
  }
  const removeButton = event.target.closest('[data-remove-watch]');
  if (removeButton) {
    const item = state.watchlist[Number(removeButton.dataset.removeWatch)];
    if (!item) return;
    apiRequest('/api/watchlist/' + encodeURIComponent(item.symbol), { method: 'DELETE' })
      .then(function () {
        state.watchlist = state.watchlist.filter(function (saved) { return saved.symbol !== item.symbol; });
        renderApp();
        showToast('Symbol removed from the server watchlist.');
      })
      .catch(function (error) { showToast(error.message); });
    return;
  }
  if (event.target.closest('#mobile-menu')) {
    sidebar.classList.toggle('is-open');
    backdrop.classList.toggle('is-visible');
    mobileMenu.setAttribute('aria-expanded', sidebar.classList.contains('is-open') ? 'true' : 'false');
    return;
  }
  if (event.target.closest('#mobile-backdrop')) closeMobileNav();
});

document.addEventListener('submit', function (event) {
  if (event.target.id === 'research-form') {
    event.preventDefault();
    const form = event.target;
    const query = form.elements.query.value.trim();
    const exchange = form.elements.exchange.value;
    const errorNode = document.getElementById('query-error');
    if (query.length < 12) {
      if (errorNode) errorNode.textContent = 'Enter a little more detail to start.';
      form.elements.query.focus();
      return;
    }
    if (errorNode) errorNode.textContent = '';
    startResearch(query, exchange);
    return;
  }
  if (event.target.id === 'watchlist-form') {
    event.preventDefault();
    const field = event.target.elements.symbol;
    const symbol = field.value.trim().toUpperCase();
    if (!symbol) return;
    if (state.watchlist.some(function (item) { return item.symbol === symbol; })) {
      showToast('That symbol is already in the watchlist.');
      return;
    }
    apiRequest('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ symbol: symbol, exchange: 'NSE / BSE' })
    }).then(function (result) {
      state.watchlist.unshift({ symbol: result.item.symbol, exchange: result.item.exchange });
      renderApp();
      showToast('Symbol saved in SQLite. Exchange listing remains unverified.');
    }).catch(function (error) { showToast(error.message); });
  }
});

document.addEventListener('input', function (event) {
  if (event.target.id === 'run-search') filterRunRows();
});
document.addEventListener('change', function (event) {
  if (event.target.id === 'run-filter') filterRunRows();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') closeMobileNav();
});

async function bootstrap() {
  try {
    await apiRequest('/api/session');
    const values = await Promise.all([
      apiRequest('/api/research/runs'),
      apiRequest('/api/watchlist'),
      apiRequest('/api/providers/health')
    ]);
    state.runs = values[0].runs || [];
    state.watchlist = values[1].items || [];
    state.providerHealth = values[2] || {};
    state.backendAvailable = true;
    state.isRunning = state.runs.some(function (run) { return run.status === 'running'; });
    const active = state.runs.find(function (run) { return run.status === 'running'; });
    const latest = active || state.runs[0];
    if (latest) {
      try {
        const detail = await refreshRunDetail(latest.id);
        if (active) connectRunEvents(detail);
      } catch (error) {
        state.selectedRunDetail = null;
      }
    }
  } catch (error) {
    state.backendAvailable = false;
    state.providerHealth = {};
  }
  renderApp();
}

renderApp();
bootstrap();
