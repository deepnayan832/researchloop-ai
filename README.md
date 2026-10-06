# ResearchLoop AI

<p align="center">
  <img src="assets/research-loop-ai-logo.svg" alt="Research Loop AI logo" width="180" />
</p>

<p align="center">
  <strong>Research Loop AI is an autonomous, evidence-driven research platform that continuously discovers, analyzes, verifies, and summarizes information from multiple sources.</strong>
</p>

<p align="center">
  <a href="https://deepnayan832.github.io/researchloop-ai/">🌐 Live Website</a> ·
  <a href="https://github.com/deepnayan832/researchloop-ai">💻 GitHub Repository</a>
</p>

Research Loop AI is designed to turn complex research tasks into a <strong>repeatable AI-powered workflow</strong> — from finding relevant information and tracking changes to cross-checking sources, analyzing trends, and generating concise, actionable insights.

### What it does

- 🔎 <strong>Deep Research</strong> — Searches and collects information from multiple sources.
- 🔄 <strong>Continuous Research Loops</strong> — Re-runs research automatically on a schedule.
- ✅ <strong>Source Verification</strong> — Cross-checks important information instead of relying on a single source.
- 🧠 <strong>AI Analysis</strong> — Identifies trends, changes, opportunities, risks, and key insights.
- 📊 <strong>Structured Intelligence</strong> — Converts raw information into clear reports and decision-ready outputs.
- ⚡ <strong>Automated Monitoring</strong> — Keeps track of topics, markets, companies, technologies, and other changing information.
- 💾 <strong>Research Memory</strong> — Stores previous findings so new research can focus on what has changed.

### Built for

<strong>Market Intelligence • Business Research • AI & Technology • Company Analysis • News Monitoring • Competitive Research • Trend Detection</strong>

<blockquote>
  <strong>Research Loop AI — Research once. Verify deeply. Track continuously. Act on better information.</strong>
</blockquote>

## Architecture

    User query
       ↓
    Planner
       ↓
    Research (Tavily + GDELT + market adapter)
       ↓
    Evidence extraction and URL / claim deduplication
       ↓
    Analyst
       ↓
    Adversarial critic and quality gate
       ↓
    Gap detector
       ↓
    Targeted retry (only unresolved questions)
       ↓
    Re-analysis and re-critique
       ↓
    Finalizer (only after the quality gate passes)
       ↓
    SQLite report + SSE progress

The loop is self-correcting within a fixed budget: at most four research iterations, four Tavily searches in the initial pass, two targeted retry tasks per iteration, and eight Tavily searches per run. It stops on a passed gate, no actionable gaps, repeated gaps without new sources, provider limits, or the iteration cap. An LLM JSON repair is counted separately from a research iteration.

## Providers

- **LLM:** OpenAI-compatible chat completions using LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL. There is no hardcoded model name. Planner, researcher, extractor, analyst, critic, gap-resolver, and finalizer prompts are loaded from prompts/ on the server.
- **Web search:** Tavily, called only by the backend. Its search count is recorded. Credit usage is stored only when the provider returns usage metadata; otherwise the estimate is DATA NOT AVAILABLE.
- **News:** GDELT DOC 2.0, which needs no API key. GDELT discoveries are always secondary evidence.
- **Market data:** An isolated Yahoo Finance chart adapter for quotes, recent daily bars, and volume. It is a vendor feed, not an exchange filing or an official NSE/BSE quote; its evidence is labeled secondary. Company profile, shareholding, and unsupported values return DATA NOT AVAILABLE. Small-cap classification remains unknown unless retrieved primary evidence verifies it.

Search and LLM credentials are read only by the server. A missing provider is reported as unavailable; the app does not invent a plan, search result, market value, evidence, confidence score, or critic score. If the planner is not configured, a request is saved as LIMITED with zero iterations and an explicit provider limitation.

Source domains are labeled primary only for recognized exchange, regulator, and government domains. Distinct publisher domains are counted, but this does not establish that publishers are editorially independent.

## Local setup

Use Node.js 22.13 or newer. The database uses Node's built-in node:sqlite module, so no separate database server is needed. Node documents this module as experimental in Node 22, so use a current supported runtime and keep database backups.

    npm install
    Copy-Item .env.example .env

Edit .env on the server. Never put provider keys in app.js, index.html, browser storage, or query parameters.

    PORT=8787
    HOST=127.0.0.1
    DATABASE_PATH=data/researchloop.sqlite

    LLM_BASE_URL=https://api.openai.com/v1
    LLM_API_KEY=
    LLM_MODEL=

    TAVILY_API_KEY=

    MARKET_DATA_PROVIDER=yahoo
    MARKET_DATA_BASE_URL=https://query1.finance.yahoo.com
    MARKET_DATA_API_KEY=

At minimum, set LLM_API_KEY and LLM_MODEL for planning, extraction, analysis, critique, and finalization. Set TAVILY_API_KEY for web search. GDELT is public. The Yahoo chart adapter does not require a key. MARKET_DATA_BASE_URL and MARKET_DATA_API_KEY are server-side adapter configuration values.

Run the app:

    npm run dev

Open http://127.0.0.1:8787. npm run server:dev is an alias. After building, npm run server:start starts the compiled server. The backend serves the existing HTML, CSS, and JavaScript, so the browser uses same-origin API requests.

## Commands

    npm install
    npm run dev
    npm run server:dev
    npm run build
    npm test
    npm run server:start
    npm run evaluate
    npm run benchmark

npm run evaluate executes the deterministic offline cases in evaluation/cases/. npm run benchmark computes metrics from runs actually saved in the configured SQLite database; with no runs it reports that there is no benchmark data.

## API

- GET /api/health — backend and database status.
- GET /api/providers/health — provider configuration state without returning credentials.
- GET /api/session — establishes an HttpOnly, SameSite local browser session.
- POST /api/research/run — validates and starts a run; returns its run_id.
- GET /api/research/runs — saved run summaries.
- GET /api/research/runs/:id — run, iteration, evidence, and report details.
- GET /api/research/runs/:id/events — replays persisted progress events, then streams new SSE events.
- GET /api/research/runs/:id/export — report JSON with sources, evidence, iterations, critiques, and metrics.
- GET /api/watchlist, POST /api/watchlist, DELETE /api/watchlist/:symbol — SQLite-backed watchlist. Adding a symbol does not verify its listing.

Write endpoints require a same-origin HttpOnly session and reject cross-origin writes. This protects a local single-user workspace; it is not multi-user identity or account management.

## Run states and evidence rules

- **COMPLETED:** the critic score is at least 85, required questions are answered, source citations validate, and no critical errors or conflicts remain.
- **LIMITED:** the run reached an honest stopping point but evidence, a provider, the quality gate, or a critical research step was unavailable.
- **FAILED:** local workflow execution failed unexpectedly.

Market statements and interpretations must cite evidence IDs. Reports distinguish facts, inferences, assumptions, and unknowns. They do not issue guaranteed outcomes or buy/sell instructions. Confidence is not scored; quality scores come from an actual configured critic response. Unsupported material claims, unknown small-cap status, or missing primary evidence block completion when relevant.

Each iteration stores its questions, source counts, critic result, and gaps. A retry is generated only from the critic's unresolved question IDs; it does not repeat the full first-pass plan. Duplicate URLs are ignored. Repeated normalized claims share one evidence record with source links retained.

## Demo mode and limitations

- The three bundled examples are static and explicitly marked Demo only. No live claims or scores appear in them.
- GDELT discovers news; it does not verify filings. Tavily results are search evidence, not proof of source authority.
- The Yahoo chart endpoint can be delayed, unavailable, or incomplete. Verify price and volume against an exchange source before relying on them.
- No integrated adapter currently verifies small-cap classification, company shareholding, institutional ownership, or a full financial-statement dataset. Those remain unknown unless retrieved sources establish them.
- Provider output and model critique can be wrong. The critic and final gate reduce unsupported claims but do not guarantee factual correctness.
- SQLite is intended for a local, single-instance workspace. Back up the database file and use persistent storage if hosting it.
- GitHub Pages can serve the static shell but cannot run this Node backend or perform live research. Run the application on a Node host to use the APIs.

## Security and data handling

.env is ignored by Git. Provider keys are used in backend requests and are excluded from logs, browser responses, URLs, local storage, and report exports. The local session cookie is HttpOnly and SameSite=Strict. SQLite stores research queries, provider evidence, watchlist symbols, progress events, and reports on the configured server path.
