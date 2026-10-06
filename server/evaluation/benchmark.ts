import { loadConfig } from "../config.js";
import { ResearchStore } from "../db/index.js";

const config = loadConfig();
const store = new ResearchStore(config.databasePath);
try {
  const runs = store.listRuns(1000);
  const completed = runs.filter((run) => run.status === "completed");
  const average = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length * 100) / 100 : null;
  };
  const output = {
    measured_at: new Date().toISOString(),
    run_count: runs.length,
    completed_count: completed.length,
    limited_count: runs.filter((run) => run.status === "limited").length,
    failed_count: runs.filter((run) => run.status === "failed").length,
    mean_initial_score: average(runs.map((run) => run.initialScore)),
    mean_final_score: average(runs.map((run) => run.finalScore)),
    mean_iterations: average(runs.map((run) => run.iterationCount)),
    sources_checked: runs.reduce((sum, run) => sum + run.sourcesChecked, 0),
    primary_sources: runs.reduce((sum, run) => sum + run.primarySources, 0),
    unresolved_gaps: runs.reduce((sum, run) => sum + run.unresolvedGaps, 0),
    note: runs.length ? undefined : "No persisted runs are available to benchmark."
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} finally {
  store.close();
}
