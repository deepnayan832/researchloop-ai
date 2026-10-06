import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, Exchange, ResearchRun } from "./types.js";
import { ResearchStore } from "./db/index.js";
import { ResearchOrchestrator } from "./loop/orchestrator.js";

const SESSION_COOKIE = "researchloop_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const SESSIONS = new Map<string, number>();
const EXCHANGES = new Set<Exchange>(["NSE", "BSE", "NSE / BSE"]);

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function hasSession(request: IncomingMessage): boolean {
  const id = cookieValue(request, SESSION_COOKIE);
  if (!id) return false;
  const expires = SESSIONS.get(id);
  if (!expires || expires < Date.now()) {
    SESSIONS.delete(id);
    return false;
  }
  return true;
}

function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const protocol = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? "https" : "http";
  return origin === protocol + "://" + request.headers.host;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new HttpError(415, "Content-Type must be application/json.");
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Request body must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function validRunRequest(body: Record<string, unknown>): { query: string; exchange: Exchange } {
  if (typeof body.query !== "string" || body.query.trim().length < 12 || body.query.trim().length > 2000) {
    throw new HttpError(400, "query must contain 12 to 2000 characters.");
  }
  const exchange = body.exchange === undefined ? "NSE" : body.exchange;
  if (typeof exchange !== "string" || !EXCHANGES.has(exchange as Exchange)) {
    throw new HttpError(400, "exchange must be NSE, BSE, or NSE / BSE.");
  }
  return { query: body.query.trim(), exchange: exchange as Exchange };
}

function publicExport(run: ResearchRun): Record<string, unknown> {
  return {
    run_id: run.id,
    query: run.query,
    exchange: run.exchange,
    status: run.status,
    iterations: run.iterations,
    evidence: run.evidence,
    critique: run.critique,
    final_report: run.report,
    sources: run.sources,
    metrics: run.metrics,
    plan: run.plan
  };
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

async function serveStatic(urlPath: string, response: ServerResponse, root: string): Promise<void> {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); }
  catch { throw new HttpError(400, "Invalid URL path."); }
  if (decoded === "/") decoded = "/index.html";
  const publicFiles = new Set(["/index.html", "/app.js", "/styles.css"]);
  const isArtifact = decoded.startsWith("/artifacts/screenshots/") &&
    /\.(png|jpg|jpeg|webp|md)$/i.test(decoded) && !decoded.includes("..");
  if (!publicFiles.has(decoded) && !isArtifact) throw new HttpError(404, "Not found.");
  const fullPath = path.resolve(root, "." + decoded);
  const resolvedRoot = path.resolve(root) + path.sep;
  if (!fullPath.startsWith(resolvedRoot)) throw new HttpError(404, "Not found.");
  const mime = decoded.endsWith(".html") ? "text/html; charset=utf-8"
    : decoded.endsWith(".js") ? "text/javascript; charset=utf-8"
      : decoded.endsWith(".css") ? "text/css; charset=utf-8"
        : decoded.endsWith(".md") ? "text/plain; charset=utf-8" : "image/png";
  const file = await readFile(fullPath);
  response.writeHead(200, { "Content-Type": mime, "Cache-Control": decoded.endsWith(".html") ? "no-cache" : "public, max-age=300" });
  response.end(file);
}

function parseAfterId(request: IncomingMessage): number {
  const value = request.headers["last-event-id"];
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function streamEvents(request: IncomingMessage, response: ServerResponse, store: ResearchStore, runId: string): void {
  const existing = store.getRun(runId);
  if (!existing) { jsonResponse(response, 404, { error: "Research run not found." }); return; }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");
  let cursor = parseAfterId(request);
  let closed = false;
  const poll = (): void => {
    if (closed) return;
    for (const item of store.eventsAfter(runId, cursor)) {
      cursor = item.id;
      response.write("id: " + item.id + "\ndata: " + JSON.stringify(item.payload) + "\n\n");
    }
    const run = store.getRun(runId);
    if (run && run.status !== "running" && store.eventsAfter(runId, cursor).length === 0) {
      closed = true;
      clearInterval(timer);
      response.end();
    }
  };
  const timer = setInterval(poll, 350);
  response.on("close", () => {
    closed = true;
    clearInterval(timer);
  });
  poll();
}

export function createResearchServer(input: {
  config: AppConfig;
  store: ResearchStore;
  orchestrator: ResearchOrchestrator;
  staticRoot?: string;
}): Server {
  const root = input.staticRoot || process.cwd();
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    const method = request.method || "GET";
    const requestUrl = new URL(request.url || "/", "http://" + (request.headers.host || "localhost"));
    const pathname = requestUrl.pathname;
    try {
      if (method === "GET" && pathname === "/api/health") {
        jsonResponse(response, 200, { status: "ok", database: input.store.health() ? "healthy" : "error" });
        return;
      }
      if (method === "GET" && pathname === "/api/providers/health") {
        jsonResponse(response, 200, {
          ...input.orchestrator.getProviderHealth(),
          database: input.store.health() ? "healthy" : "error",
          database_detail: "The local SQLite database is connected."
        });
        return;
      }
      if (method === "GET" && pathname === "/api/session") {
        const current = cookieValue(request, SESSION_COOKIE);
        if (!current || !hasSession(request)) {
          const id = randomBytes(24).toString("base64url");
          for (const [key, expires] of SESSIONS) if (expires < Date.now()) SESSIONS.delete(key);
          SESSIONS.set(id, Date.now() + SESSION_TTL_MS);
          const secure = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? "; Secure" : "";
          response.setHeader("Set-Cookie", SESSION_COOKIE + "=" + id + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + String(SESSION_TTL_MS / 1000) + secure);
        }
        jsonResponse(response, 200, { authenticated: true, expires_in_seconds: SESSION_TTL_MS / 1000 });
        return;
      }
      if (pathname.startsWith("/api/")) {
        if ((method === "POST" || method === "DELETE") && !isSameOrigin(request)) {
          jsonResponse(response, 403, { error: "Cross-origin API writes are not allowed." });
          return;
        }
        if (!hasSession(request)) {
          jsonResponse(response, 401, { error: "A same-origin ResearchLoop session is required." });
          return;
        }
        if (method === "GET" && pathname === "/api/research/runs") {
          jsonResponse(response, 200, { runs: input.store.listRuns() });
          return;
        }
        if (method === "POST" && (pathname === "/api/research/run" || pathname === "/api/research/runs")) {
          const requestBody = validRunRequest(await readJson(request));
          const run = input.store.createRun(requestBody.query, requestBody.exchange);
          response.writeHead(202, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ run_id: run.id, run }));
          input.orchestrator.start(run.id);
          return;
        }
        const streamMatch = /^\/api\/research\/runs\/([^/]+)\/events$/.exec(pathname);
        if (method === "GET" && streamMatch) {
          streamEvents(request, response, input.store, decodeURIComponent(streamMatch[1]!));
          return;
        }
        const exportMatch = /^\/api\/research\/runs\/([^/]+)\/export$/.exec(pathname);
        if (method === "GET" && exportMatch) {
          const run = input.store.getRun(decodeURIComponent(exportMatch[1]!));
          if (!run) { jsonResponse(response, 404, { error: "Research run not found." }); return; }
          response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"researchloop-" + run.id.replace(/[^a-zA-Z0-9_-]/g, "") + ".json\"",
            "Cache-Control": "no-store"
          });
          response.end(JSON.stringify(publicExport(run), null, 2));
          return;
        }
        const runMatch = /^\/api\/research\/runs\/([^/]+)$/.exec(pathname);
        if (method === "GET" && runMatch) {
          const run = input.store.getRun(decodeURIComponent(runMatch[1]!));
          if (!run) { jsonResponse(response, 404, { error: "Research run not found." }); return; }
          jsonResponse(response, 200, { run });
          return;
        }
        if (method === "GET" && pathname === "/api/watchlist") {
          jsonResponse(response, 200, { items: input.store.getWatchlist() });
          return;
        }
        if (method === "POST" && pathname === "/api/watchlist") {
          const body = await readJson(request);
          if (typeof body.symbol !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.&-]{0,19}$/.test(body.symbol.trim())) {
            throw new HttpError(400, "symbol must use 1 to 20 letters, numbers, dots, ampersands, or hyphens.");
          }
          const exchange = body.exchange === undefined ? "NSE / BSE" : body.exchange;
          if (typeof exchange !== "string" || !EXCHANGES.has(exchange as Exchange)) throw new HttpError(400, "exchange must be NSE, BSE, or NSE / BSE.");
          const symbol = body.symbol.trim().toUpperCase();
          input.store.addWatchlist(symbol, exchange as Exchange);
          jsonResponse(response, 201, { item: { symbol, exchange, listing_status: "NOT VERIFIED" } });
          return;
        }
        const watchMatch = /^\/api\/watchlist\/([^/]+)$/.exec(pathname);
        if (method === "DELETE" && watchMatch) {
          const symbol = decodeURIComponent(watchMatch[1]!).toUpperCase();
          if (!/^[A-Z0-9][A-Z0-9.&-]{0,19}$/.test(symbol)) throw new HttpError(400, "symbol format is invalid.");
          jsonResponse(response, 200, { removed: input.store.removeWatchlist(symbol), symbol });
          return;
        }
        jsonResponse(response, 404, { error: "API endpoint not found." });
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
      }
      if (method === "HEAD") { response.writeHead(405); response.end(); return; }
      await serveStatic(pathname, response, root);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Internal server error.";
      jsonResponse(response, status, { error: status === 500 ? "Internal server error." : message });
    }
  });
  return server;
}
