import { loadConfig } from "./config.js";
import { ResearchStore } from "./db/index.js";
import { createResearchServer } from "./http.js";
import { ResearchOrchestrator } from "./loop/orchestrator.js";

const config = loadConfig();
const store = new ResearchStore(config.databasePath);
store.recoverInterruptedRuns();
const orchestrator = new ResearchOrchestrator(store, config);
const server = createResearchServer({ config, store, orchestrator });

function pruneResearchHistory(): void {
  const days = config.researchRetentionDays || 0;
  if (days < 1) return;
  const deleted = store.deleteRunsOlderThan(days);
  if (deleted > 0) {
    process.stdout.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      stage: "retention",
      result: "pruned",
      deleted_runs: deleted,
      retention_days: days
    }) + "\n");
  }
}

let retentionTimer: NodeJS.Timeout | undefined;
if ((config.researchRetentionDays || 0) > 0) {
  pruneResearchHistory();
  retentionTimer = setInterval(pruneResearchHistory, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
}

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  process.stdout.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    stage: "server",
    result: "listening",
    url: config.publicOrigin || ("http://" + config.host + ":" + port),
    database: config.databasePath
  }) + "\n");
});

function shutdown(): void {
  if (retentionTimer) clearInterval(retentionTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
