export type ChatRole = 'user' | 'assistant';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface JsonSchemaSpec {
  name: string;
  /** Wszystkie pola wymagane i additionalProperties: false — zgodne z trybem strict obu dostawców. */
  schema: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  jsonSchema?: JsonSchemaSpec;
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  /** Sparsowany JSON, gdy żądanie miało jsonSchema. */
  json?: unknown;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  stopReason?: string;
}

/** Jedyny kontrakt, który musi spełnić nowy dostawca modeli. */
export interface AIProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class AIProviderError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(provider: string, status: number, message: string, retryable: boolean) {
    super(`[${provider}] ${message}`);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}
