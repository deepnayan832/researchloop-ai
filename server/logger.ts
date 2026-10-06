export function logRun(input: {
  runId: string;
  iteration: number;
  stage: string;
  provider: string;
  durationMs: number;
  result: string;
  error?: string | null;
}): void {
  const row = {
    timestamp: new Date().toISOString(),
    run_id: input.runId,
    iteration: input.iteration,
    stage: input.stage,
    provider: input.provider,
    duration_ms: input.durationMs,
    result: input.result,
    ...(input.error ? { error: input.error.slice(0, 500) } : {})
  };
  process.stdout.write(JSON.stringify(row) + "\n");
}
