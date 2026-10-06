const MAX_ITERATIONS = 4;
const PASS_SCORE = 85;
const RUNS_KEY = 'researchloop-runs-v1';
const WATCHLIST_KEY = 'researchloop-watchlist-v1';

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
  runs: loadStoredRuns(),
  watchlist: loadWatchlist(),
  selectedRunId: null,
  isRunning: false,
  toastTimer: null
};

const content = document.getElementById('app-content');
const topbarTitle = document.getElementById('topbar-title');
const toastNode = document.getElementById('toast');
const sidebar = document.getElementById('sidebar');
const mobileMenu = document.getElementById('mobile-menu');
const backdrop = document.getElementById('mobile-backdrop');

function loadStoredRuns() {
  try {
    const value = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.map(function (run) {
      if (run.status === 'running') {
        run.status = 'limited';
        run.stage = 'finalize';
        run.unresolvedGaps = Math.max(1, run.unresolvedGaps || 0);
      }
      return run;
    });
  } catch (error) {
    return [];
  }
}

function loadWatchlist() {
  try {
    const value = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveRuns() {
  localStorage.setItem(RUNS_KEY, JSON.stringify(state.runs));
}

function saveWatchlist() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state.watchlist));
}

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
  return 'Not verified';
}

function statusClass(run) {
  if (run.isDemo) return 'status-demo';
  if (run.status === 'running') return 'status-running';
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
  const stages = ['plan', 'research', 'critique', 'finalize'];
  return Math.max(0, stages.indexOf(run.stage || 'finalize'));
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
    { key: 'plan', title: 'Plan', fallback: 'Research questions prepared.' },
    { key: 'research', title: 'Research', fallback: 'No live source provider is connected.' },
    { key: 'critique', title: 'Critique', fallback: 'Evidence gaps are reviewed.' },
    { key: 'finalize', title: 'Finalize', fallback: 'Report prepared with limitations.' }
  ];
  const current = stepIndex(run);
  return '<ol class="timeline">' + stages.map(function (item, index) {
    const traceItem = (run.trace || []).find(function (entry) { return entry.stage === item.key; });
    const done = run.status !== 'running' ? index <= current : index < current;
    const active = run.status === 'running' && index === current;
    const nodeClass = done ? 'done' : active ? 'current' : '';
    const mark = done ? icon('check') : '';
    const detail = traceItem ? traceItem.detail : item.fallback;
    return '<li class="timeline-item"><span class="timeline-node ' + nodeClass + '">' + mark + '</span><div class="timeline-copy"><strong>' + item.title + (run.status === 'running' && active ? ' in progress' : '') + '</strong><span>' + escapeHtml(detail) + '</span></div><span class="timeline-time">' + (traceItem ? (run.isDemo ? 'Example' : 'Logged') : '') + '</span></li>';
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
  return '<div class="table-scroll"><table class="data-table run-table"><thead><tr><th>Research item</th><th>Research question</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' + (rows || empty) + '</tbody></table></div>' + (showFooter ? '<div class="panel-table-foot"><span>Demo example and local runs</span><span>' + runs.length + ' item' + (runs.length === 1 ? '' : 's') + '</span></div>' : '');
}

function renderNotice(compact) {
  return '<div class="demo-notice ' + (compact ? 'compact' : '') + '">' + icon('info') + '<div><strong>Demo report · No live exchange data connected</strong><p>This preview does not check exchange filings, company disclosures, market prices, or financial statements. Results are not investment advice.</p></div></div>';
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
    '<div class="query-footnote"><span>Research is in demo mode. Connect a source provider to verify live claims.</span><span class="query-error" id="query-error" aria-live="polite"></span></div></section>' +
    renderProcess(latest) +
    '<section class="overview-grid"><div class="panel"><div class="panel-head"><h2 class="section-title">Recent research runs</h2><button class="button button-quiet" type="button" data-view="runs">View all runs ' + icon('arrow') + '</button></div>' + renderRunTable(runs.slice(0, 4), true) + '</div>' +
    '<aside class="panel run-panel"><div class="panel-head"><h2 class="section-title">Latest run</h2><span class="panel-head-meta">' + (latest.isDemo ? 'Example' : displayDate(latest)) + '</span></div><div class="panel-content">' +
    '<div class="run-detail-head"><div><strong>' + (latest.isDemo ? escapeHtml(latest.label) : 'Research request') + '</strong><span>' + escapeHtml(latest.exchange || 'NSE / BSE') + ' · ' + statusText(latest) + '</span></div><span class="run-detail-date">' + (latest.isDemo ? 'No live data' : displayTime(latest)) + '</span></div>' +
    '<p class="run-question">' + escapeHtml(latest.query) + '</p><div class="iteration-label"><span>Iteration ' + (latest.iterationCount || 1) + ' of ' + MAX_ITERATIONS + '</span><span>' + (latest.status === 'running' ? 'Research in progress' : latest.isDemo ? 'Example only' : 'Finalized with limitations') + '</span></div>' +
    timelineMarkup(latest) + '<button class="button button-primary panel-full-button" type="button" data-open-report="' + escapeHtml(latest.id) + '">Open report ' + icon('arrow') + '</button></div></aside></section>';
}

function renderRunsPage() {
  const runs = getAllRuns();
  return '<div class="page-head"><div><h1>Research runs</h1><p>Review the requests and run traces saved in this browser.</p></div><button class="button button-primary" type="button" data-new-research>' + icon('plus') + ' New research</button></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Local preview</strong><p>Live exchange and company sources are not connected. New requests finish with explicit data limitations.</p></div></div>' +
    '<section class="panel list-panel"><div class="list-toolbar"><div class="toolbar"><label class="search-control">' + icon('search') + '<span class="sr-only">Search runs</span><input type="search" id="run-search" placeholder="Search research questions" /></label><select class="filter-select" id="run-filter" aria-label="Filter runs"><option value="all">All runs</option><option value="limited">Limited</option><option value="demo">Demo only</option></select></div><span class="result-count" id="run-result-count">' + runs.length + ' items</span></div><div id="runs-table">' + renderRunTable(runs, false) + '</div></section>';
}

function renderReportsPage() {
  const reports = getAllRuns().filter(function (run) { return run.isDemo || run.status === 'limited'; });
  return '<div class="page-head"><div><h1>Reports</h1><p>Final research summaries with evidence status, gaps, and run details.</p></div><button class="button button-secondary" type="button" data-export-list>' + icon('download') + ' Export run list</button></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Evidence status is explicit</strong><p>Reports in this preview contain no verified market evidence because live sources are not connected.</p></div></div>' +
    '<section class="panel list-panel"><div class="panel-head"><h2 class="section-title">Available reports</h2><span class="panel-head-meta">' + reports.length + ' report' + (reports.length === 1 ? '' : 's') + '</span></div>' + renderRunTable(reports, true) + '</section>';
}

function renderWatchlist() {
  const rows = state.watchlist.map(function (item, index) {
    return '<tr><td><span class="watchlist-symbol">' + escapeHtml(item.symbol) + '</span></td><td>' + escapeHtml(item.exchange) + '</td><td><span class="status-chip status-demo">Data not available</span></td><td><button class="button button-quiet" type="button" data-remove-watch="' + index + '">Remove</button></td></tr>';
  }).join('');
  const table = state.watchlist.length ? '<div class="table-scroll"><table class="data-table watchlist-table"><thead><tr><th>Symbol</th><th>Exchange</th><th>Market data</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="panel-empty-state watchlist-empty"><span class="empty-icon">' + icon('chart') + '</span><strong>Your watchlist is empty</strong><p>Add a ticker to keep it in this browser. Live prices and classifications are not available in demo mode.</p></div>';
  return '<div class="page-head"><div><h1>Watchlist</h1><p>Keep research targets in one place. Market data requires a live source connection.</p></div><form class="watchlist-form" id="watchlist-form"><label class="sr-only" for="watch-symbol">Company symbol</label><input id="watch-symbol" name="symbol" maxlength="20" placeholder="Add NSE / BSE symbol" required /><button class="button button-primary" type="submit">' + icon('plus') + ' Add symbol</button></form></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Watchlist is saved locally</strong><p>Symbols are stored in this browser only. No company lookup or exchange validation is performed.</p></div></div>' +
    '<section class="panel list-panel"><div class="panel-head"><h2 class="section-title">Saved symbols</h2><span class="panel-head-meta">' + state.watchlist.length + ' item' + (state.watchlist.length === 1 ? '' : 's') + '</span></div>' + table + '</section>';
}

function renderSettings() {
  return '<div class="page-head"><div><h1>Settings</h1><p>Research policy and source priorities from the ResearchLoop prompt.</p></div></div>' +
    '<div class="demo-notice compact page-intro-notice">' + icon('info') + '<div><strong>Settings shown for the preview</strong><p>These values describe the intended workflow. They do not configure a live research provider.</p></div></div>' +
    '<div class="config-grid"><section class="panel"><div class="panel-head"><h2 class="section-title">Loop controls</h2></div><div class="config-row"><div class="config-copy"><strong>Maximum iterations</strong><span>Stop after this many plan, research, critique, and retry cycles.</span></div><span class="config-value">' + MAX_ITERATIONS + '</span></div><div class="config-row"><div class="config-copy"><strong>Minimum pass score</strong><span>Finalize with limitations if the report does not meet this threshold.</span></div><span class="config-value">' + PASS_SCORE + ' / 100</span></div><div class="config-row"><div class="config-copy"><strong>Retry approach</strong><span>Research only unresolved gaps when meaningful new evidence may be found.</span></div><span class="config-value">Targeted</span></div></section>' +
    '<section class="panel"><div class="panel-head"><h2 class="section-title">Source priority</h2></div><div class="config-row"><div class="config-copy"><strong>Preferred sources</strong><span>Use higher priority sources first and keep lower-tier material in context.</span><div class="tier-list"><span>Exchange filings</span><span>Company filings</span><span>Audited statements</span><span>Investor presentations</span><span>Financial news</span></div></div></div><div class="config-row"><div class="config-copy"><strong>Universe checks</strong><span>Verify current small-cap classification and exclude SME securities unless requested.</span></div><span class="config-value">Required</span></div><div class="config-row"><div class="config-copy"><strong>Data provider</strong><span>Live research tools are not configured in this preview.</span></div><span class="status-chip status-demo">Not connected</span></div></section></div>';
}

function reportTrace(run) {
  return timelineMarkup(run);
}

function reportSummary(run) {
  const values = [
    ['run_id', run.id],
    ['iterations', run.iterationCount || 1],
    ['initial_score', 'DATA NOT AVAILABLE'],
    ['final_score', 'DATA NOT AVAILABLE'],
    ['sources_checked', run.sourcesChecked || 0],
    ['primary_sources', run.primarySources || 0],
    ['secondary_sources', run.secondarySources || 0],
    ['critical_gaps_found', run.criticalGapsFound || 1],
    ['critical_gaps_resolved', run.criticalGapsResolved || 0],
    ['unresolved_gaps', run.unresolvedGaps || 1],
    ['status', run.isDemo ? 'DEMO' : 'LIMITED']
  ];
  return '<div class="run-summary"><h3>Run summary</h3><div class="summary-grid">' + values.map(function (item) { return '<span>' + item[0] + '</span><strong>' + escapeHtml(item[1]) + '</strong>'; }).join('') + '</div></div>';
}

function renderReport(run) {
  const query = escapeHtml(run.query);
  const exchange = escapeHtml(run.exchange || 'NSE / BSE');
  return '<div class="report-top"><button class="back-link" type="button" data-view="runs">' + icon('back') + ' Research runs</button><h1>Company research report</h1>' + renderNotice(true) +
    '<div class="report-identity"><div><h2>' + (run.isDemo ? escapeHtml(run.label) : 'Research request') + '</h2><span class="report-symbol">' + exchange + ' · ' + (run.isDemo ? 'Example' : 'Local preview') + '</span></div><span class="status-chip status-limited">' + (run.isDemo ? 'Demo only' : 'Complete with limitations') + '</span><div class="report-meta"><span><strong>Research question</strong>' + query + '</span><button class="button button-secondary" type="button" data-export="' + escapeHtml(run.id) + '">' + icon('download') + ' Export report</button></div></div></div>' +
    '<div class="report-layout"><article class="panel report-main">' +
    '<section class="report-section"><div class="report-summary-grid"><div><h3>Executive summary</h3><p>No live research was performed for this request. The preview attempted to organize the question, but exchange filings, company disclosures, market prices, financial statements, and current small-cap classification were not checked. The result is incomplete and should not be used as investment research.</p></div><div class="confidence-block"><span class="confidence-value">DATA NOT AVAILABLE</span><span class="unavailable-pill">No evidence collected</span><span class="confidence-label">A confidence score is not assigned without verified evidence.</span></div></div></section>' +
    '<section class="report-section"><h3>What happened</h3><p>Not verified. No exchange price or volume data was retrieved for this research request.</p></section>' +
    '<section class="report-section"><h3>Verified evidence</h3><p>DATA NOT AVAILABLE — no source provider is connected, so no claims were verified.</p><div class="report-table"><div class="table-scroll"><table class="data-table"><thead><tr><th>Research question</th><th>Source</th><th>Publication date</th><th>Confidence</th></tr></thead><tbody><tr><td>Exchange filing and market move</td><td>Not checked</td><td>DATA NOT AVAILABLE</td><td>—</td></tr><tr><td>Latest financial statements</td><td>Not checked</td><td>DATA NOT AVAILABLE</td><td>—</td></tr><tr><td>Current small-cap classification</td><td>Not checked</td><td>DATA NOT AVAILABLE</td><td>—</td></tr></tbody></table></div></div></section>' +
    '<section class="report-section"><h3>Likely drivers</h3><p>Not assessed. No company announcement, quarterly result, sector development, or other catalyst was researched.</p></section>' +
    '<section class="report-section"><h3>Fundamental context</h3><p>DATA NOT AVAILABLE — revenue, profitability, cash flow, leverage, shareholding, and valuation were not checked.</p></section>' +
    '<section class="report-section"><h3>Bull case and bear case</h3><p>No investment case is presented because there is no verified evidence to support one.</p></section>' +
    '<section class="report-section"><h3>Contradictory evidence</h3><p>No sources were checked, so conflicts could not be assessed.</p></section></article>' +
    '<aside class="panel report-side"><h2 class="section-title">Research loop</h2><div class="iteration-label"><span>Iteration ' + (run.iterationCount || 1) + ' of ' + MAX_ITERATIONS + '</span><span>Limited</span></div>' + reportTrace(run) +
    '<div class="unknown-block"><h3>What remains unknown</h3><ul class="unknown-list"><li>Whether the security is currently classified as small-cap.</li><li>What exchange filings or company announcements were published.</li><li>Whether the requested market move occurred and at what volume.</li><li>Whether the latest fundamental data changes the analysis.</li></ul></div>' + reportSummary(run) +
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

function startResearch(query, exchange) {
  const run = {
    id: 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    query: query,
    exchange: exchange,
    status: 'running',
    stage: 'plan',
    createdAt: new Date().toISOString(),
    iterationCount: 1,
    trace: [{ stage: 'plan', title: 'Plan prepared', detail: 'Research questions organized for the submitted query.' }],
    sourcesChecked: 0,
    primarySources: 0,
    secondarySources: 0,
    criticalGapsFound: 0,
    criticalGapsResolved: 0,
    unresolvedGaps: 0,
    confidence: null
  };
  state.runs.unshift(run);
  state.selectedRunId = run.id;
  state.isRunning = true;
  saveRuns();
  renderApp();
  showToast('Research loop started in demo mode. No live source checks will run.');

  window.setTimeout(function () {
    run.stage = 'research';
    run.trace.push({ stage: 'research', title: 'Research unavailable', detail: 'No live source provider is configured; 0 sources were checked.' });
    saveRuns();
    renderApp();
  }, 700);

  window.setTimeout(function () {
    run.stage = 'critique';
    run.criticalGapsFound = 1;
    run.unresolvedGaps = 1;
    run.trace.push({ stage: 'critique', title: 'Critical gap identified', detail: 'Source access is required to verify the requested market and company information.' });
    saveRuns();
    renderApp();
  }, 1450);

  window.setTimeout(function () {
    run.stage = 'finalize';
    run.status = 'limited';
    run.trace.push({ stage: 'finalize', title: 'Finalized with limitations', detail: 'No meaningful retry is possible until a live research source is connected.' });
    state.isRunning = false;
    saveRuns();
    setView('report');
    showToast('Run finalized with limitations. No live source checks were performed.');
  }, 2300);
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
    const matchStatus = status === 'all' || (status === 'demo' && isDemo) || (status === 'limited' && isLimited);
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
    status: run.isDemo ? 'DEMO' : 'LIMITED',
    note: 'No live source checks were performed in this demo.'
  };
  const payload = { report_status: summary.status, run_summary: summary, trace: run.trace || [] };
  downloadFile('researchloop-' + run.id + '.json', JSON.stringify(payload, null, 2), 'application/json');
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
    state.selectedRunId = openButton.dataset.openReport;
    setView('report');
    return;
  }
  if (event.target.closest('[data-new-research]')) {
    setView('overview');
    window.setTimeout(function () { document.getElementById('research-query')?.focus(); }, 40);
    return;
  }
  if (event.target.closest('.workspace-button')) {
    showToast('This preview has one local demo workspace.');
    return;
  }
  const exportButton = event.target.closest('[data-export]');
  if (exportButton) {
    exportRun(getRun(exportButton.dataset.export));
    showToast('Report summary downloaded as JSON.');
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
    state.watchlist.splice(Number(removeButton.dataset.removeWatch), 1);
    saveWatchlist();
    renderApp();
    showToast('Symbol removed from this browser’s watchlist.');
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
    const symbol = field.value.trim().toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
    if (!symbol) return;
    if (state.watchlist.some(function (item) { return item.symbol === symbol; })) {
      showToast('That symbol is already in the watchlist.');
      return;
    }
    state.watchlist.unshift({ symbol: symbol, exchange: 'Not verified' });
    saveWatchlist();
    renderApp();
    showToast('Symbol saved locally. Exchange listing is not verified.');
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

renderApp();
