import type { AppConfig, ProviderUsage, UsageCallback } from "../types.js";
import { ProviderError, SchemaValidationError } from "../errors.js";

export type Validator<T> = (value: unknown) => T;

export interface LLMProvider {
  readonly configured: boolean;
  generateText(system: string, user: string, onUsage?: UsageCallback): Promise<string>;
  generateStructured<T>(
    system: string,
    prompt: string,
    user: string,
    validate: Validator<T>,
    onUsage?: UsageCallback
  ): Promise<T>;
}

function recordUsage(onUsage: UsageCallback | undefined, usage: unknown, error?: string): void {
  if (!onUsage) return;
  const value = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const parsed: ProviderUsage = {
    ...(typeof value.prompt_tokens === "number" ? { promptTokens: value.prompt_tokens } : {}),
    ...(typeof value.completion_tokens === "number" ? { completionTokens: value.completion_tokens } : {}),
    ...(typeof value.total_tokens === "number" ? { totalTokens: value.total_tokens } : {})
  };
  onUsage("llm", Object.keys(parsed).length ? parsed : undefined, error);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly configured: boolean;

  constructor(private readonly config: AppConfig, private readonly timeoutMs = 45000) {
    this.configured = Boolean(config.llmApiKey && config.llmModel);
  }

  async generateText(system: string, user: string, onUsage?: UsageCallback): Promise<string> {
    const response = await this.request(system, user, false, onUsage);
    const message = response.choices?.[0]?.message?.content;
    if (typeof message !== "string" || !message.trim()) {
      recordUsage(onUsage, response.usage, "Model returned empty content.");
      throw new ProviderError("llm", "The LLM provider returned an empty response.");
    }
    return message;
  }

  async generateStructured<T>(
    system: string,
    prompt: string,
    user: string,
    validate: Validator<T>,
    onUsage?: UsageCallback
  ): Promise<T> {
    const content = (response: { choices?: Array<{ message?: { content?: unknown } }> }): string => {
      const value = response.choices?.[0]?.message?.content;
      if (typeof value !== "string" || !value.trim()) throw new ProviderError("llm", "The LLM provider returned empty structured output.");
      return value;
    };
    let raw = content(await this.request(system, prompt + "\nReturn a single JSON object and no markdown.", true, onUsage, user));
    try {
      return validate(JSON.parse(raw));
    } catch (firstError) {
      const reason = firstError instanceof Error ? firstError.message : "schema validation failed";
      raw = content(await this.request(
        system,
        prompt + "\nThe previous response failed JSON/schema validation: " + reason +
          "\nRepair it. Return only a valid JSON object conforming exactly to the requested schema.",
        true,
        onUsage,
        user + "\n\nPrevious invalid response:\n" + raw.slice(0, 12000)
      ));
      try {
        return validate(JSON.parse(raw));
      } catch (secondError) {
        const detail = secondError instanceof Error ? secondError.message : "schema validation failed";
        throw new ProviderError("llm", "Structured output remained invalid after one repair attempt: " + detail);
      }
    }
  }

  private async request(
    system: string,
    prompt: string,
    json: boolean,
    onUsage?: UsageCallback,
    user?: string
  ): Promise<{ choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown }> {
    if (!this.configured) throw new ProviderError("llm", "LLM_API_KEY and LLM_MODEL are required for live analysis.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.config.llmBaseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + this.config.llmApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          temperature: 0.1,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system + "\n\n" + prompt },
            { role: "user", content: user || prompt }
          ]
        }),
        signal: controller.signal
      });
      const bodyText = await response.text();
      let body: { choices?: Array<{ message?: { content?: unknown } }>; usage?: unknown } = {};
      try { body = JSON.parse(bodyText) as typeof body; } catch { /* handled as a provider response error below */ }
      recordUsage(onUsage, body.usage, response.ok ? undefined : "LLM HTTP " + response.status);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new ProviderError("llm", "LLM provider returned HTTP " + response.status + ".", response.status, retryable);
      }
      if (!body.choices) throw new ProviderError("llm", "LLM provider returned malformed JSON.");
      return body;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        recordUsage(onUsage, undefined, "LLM request timed out.");
        throw new ProviderError("llm", "LLM request timed out.", null, true);
      }
      const message = error instanceof Error ? error.message : "network error";
      recordUsage(onUsage, undefined, message);
      throw new ProviderError("llm", "LLM request failed: " + message, null, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function requireJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchemaValidationError(label + " must be a JSON object.");
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string, min = 1, max = 4000): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new SchemaValidationError(label + " must be a string with " + min + "-" + max + " characters.");
  }
  return value.trim();
}

export function requireArray(value: unknown, label: string, max = 50): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new SchemaValidationError(label + " must be an array of at most " + max + " items.");
  return value;
}

export function requireScore(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) {
    throw new SchemaValidationError(label + " must be an integer from 0 to 100.");
  }
  return Number(value);
}

export function requireStringArray(value: unknown, label: string, max = 30): string[] {
  return requireArray(value, label, max).map((item) => requireString(item, label + " item", 1, 1200));
}
