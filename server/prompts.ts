import { readFileSync } from "node:fs";
import path from "node:path";

export type PromptName = "system" | "planner" | "researcher" | "extractor" | "analyst" | "critic" | "gap-resolver" | "finalizer";

export class PromptRegistry {
  private readonly cache = new Map<PromptName, string>();

  constructor(private readonly promptDir = path.resolve(process.cwd(), "prompts")) {}

  get(name: PromptName): string {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const content = readFileSync(path.join(this.promptDir, name + ".prompt"), "utf8").trim();
    if (!content) throw new Error("Prompt file is empty: " + name);
    this.cache.set(name, content);
    return content;
  }
}
