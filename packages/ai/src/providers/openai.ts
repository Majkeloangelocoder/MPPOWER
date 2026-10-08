import { AIProviderError, type AIProvider, type ContentPart, type GenerateRequest, type GenerateResult } from '../types.ts';
import { finalize, postJson } from './shared.ts';

interface OpenAIResponse {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAIOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Część modeli rozumujących odrzuca parametr temperature — domyślnie go nie wysyłamy. */
  supportsTemperature?: boolean;
}

/** Zapasowy dostawca przez Chat Completions; JSON przez response_format (json_schema, strict). */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly supportsTemperature: boolean;

  constructor(opts: OpenAIOptions) {
    if (!opts.apiKey) throw new Error('OpenAIProvider: missing apiKey');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.supportsTemperature = opts.supportsTemperature ?? false;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    const messages: Array<Record<string, unknown>> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: toOpenAIContent(m.content) });

    const body: Record<string, unknown> = { model: req.model, messages, max_completion_tokens: req.maxTokens };
    if (this.supportsTemperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true },
      };
    }

    const data = (await postJson(
      this.fetchImpl,
      this.name,
      `${this.baseUrl}/v1/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      body,
      req.timeoutMs ?? 30_000,
    )) as OpenAIResponse | null;

    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) throw new AIProviderError(this.name, 200, 'model declined the request', false);
    return finalize(
      {
        text: choice?.message?.content ?? '',
        provider: this.name,
        model: data?.model ?? req.model,
        usage: { inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 },
        latencyMs: Date.now() - started,
        stopReason: choice?.finish_reason,
      },
      req,
    );
  }
}

function toOpenAIContent(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}` } },
  );
}
