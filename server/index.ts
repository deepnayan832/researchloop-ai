import { loadConfig } from "./config.js";
import { ResearchStore } from "./db/index.js";
import { createResearchServer } from "./http.js";
import { ResearchOrchestrator } from "./loop/orchestrator.js";

const config = loadConfig();
const store = new ResearchStore(config.databasePath);
store.recoverInterruptedRuns();
const orchestrator = new ResearchOrchestrator(store, config);
const server = createResearchServer({ config, store, orchestrator });

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  process.stdout.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    stage: "server",
    result: "listening",
    url: "http://" + config.host + ":" + port,
    database: config.databasePath
  }) + "\n");
});

function shutdown(): void {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
