export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly statusCode: number | null = null,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}
