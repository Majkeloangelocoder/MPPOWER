import type { AIProvider, GenerateRequest, GenerateResult } from '../types.ts';
import { finalize } from './shared.ts';

export type MockHandler = (req: GenerateRequest) => string | Error | Promise<string | Error>;

/** Dostawca do testów i trybu offline: zwraca przygotowany tekst albo rzuca błąd. */
export class MockProvider implements AIProvider {
  readonly name: string;
  readonly calls: GenerateRequest[] = [];
  private readonly handler: MockHandler;

  constructor(handler: MockHandler, name = 'mock') {
    this.handler = handler;
    this.name = name;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);
    const out = await this.handler(req);
    if (out instanceof Error) throw out;
    return finalize(
      { text: out, provider: this.name, model: req.model, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0 },
      req,
    );
  }
}
