import { runEvaluationCases } from "./evaluator.js";

const results = runEvaluationCases();
const failed = results.filter((result) => !result.passed);
process.stdout.write(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2) + "\n");
if (failed.length) process.exitCode = 1;
