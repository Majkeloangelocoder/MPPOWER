import { AIProviderError, type AIProvider, type ContentPart, type GenerateRequest, type GenerateResult } from '../types.ts';
import { finalize, postJson } from './shared.ts';

interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

/** Claude przez Messages API; ustrukturyzowane odpowiedzi przez output_config.format (json_schema). */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions) {
    if (!opts.apiKey) throw new Error('AnthropicProvider: missing apiKey');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
    this.apiVersion = opts.apiVersion ?? '2023-06-01';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
    };
    if (req.system) body.system = req.system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.jsonSchema) body.output_config = { format: { type: 'json_schema', schema: req.jsonSchema.schema } };

    const data = (await postJson(
      this.fetchImpl,
      this.name,
      `${this.baseUrl}/v1/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': this.apiVersion },
      body,
      req.timeoutMs ?? 30_000,
    )) as AnthropicResponse | null;

    if (data?.stop_reason === 'refusal') throw new AIProviderError(this.name, 200, 'model declined the request', false);
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return finalize(
      {
        text,
        provider: this.name,
        model: data?.model ?? req.model,
        usage: { inputTokens: data?.usage?.input_tokens ?? 0, outputTokens: data?.usage?.output_tokens ?? 0 },
        latencyMs: Date.now() - started,
        stopReason: data?.stop_reason,
      },
      req,
    );
  }
}

function toAnthropicContent(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } },
  );
}
