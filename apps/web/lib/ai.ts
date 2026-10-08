import { AIGateway, AnthropicProvider, OpenAIProvider, createDefaultPolicies, type AIProvider, type ModelRoute, type UsageEvent } from '@mp-power/ai';
import { env } from './env';
import { supabaseAdmin } from './supabase-admin';

let gateway: AIGateway | null | undefined;

/**
 * AI Gateway z konfiguracji środowiska: Claude jako dostawca główny, OpenAI opcjonalnie jako zapas.
 * Brak kluczy → null, a funkcje AI przechodzą na odpowiedzi z reguł.
 */
export function aiGateway(): AIGateway | null {
  if (gateway !== undefined) return gateway;
  const providers: Record<string, AIProvider> = {};
  const anthropicKey = env.optional('ANTHROPIC_API_KEY');
  const openaiKey = env.optional('OPENAI_API_KEY');
  if (anthropicKey) providers.anthropic = new AnthropicProvider({ apiKey: anthropicKey });
  if (openaiKey) providers.openai = new OpenAIProvider({ apiKey: openaiKey });
  if (Object.keys(providers).length === 0) {
    gateway = null;
    return gateway;
  }

  const claude = (name: string, fallbackModel: string): ModelRoute => ({ provider: 'anthropic', model: env.optional(name) ?? fallbackModel });
  const openai = (name: string): ModelRoute | undefined => {
    const model = env.optional(name);
    return openaiKey && model ? { provider: 'openai', model } : undefined;
  };

  gateway = new AIGateway({
    providers,
    policies: createDefaultPolicies({
      fast: claude('AI_MODEL_FAST', 'claude-haiku-5-5'),
      coach: claude('AI_MODEL_COACH', 'claude-sonnet-5-5'),
      vision: claude('AI_MODEL_VISION', 'claude-sonnet-5-5'),
      fallback: { fast: openai('OPENAI_MODEL_FAST'), coach: openai('OPENAI_MODEL_COACH'), vision: openai('OPENAI_MODEL_VISION') },
    }),
    onUsage: logUsage,
  });
  return gateway;
}

/** Koszty i jakość: każde wywołanie modelu trafia do ai_requests (panel → zakładka AI). */
async function logUsage(e: UsageEvent): Promise<void> {
  await supabaseAdmin().from('ai_requests').insert({
    user_id: e.userId ?? null,
    task: e.task,
    provider: e.provider,
    model: e.model,
    prompt_version: e.promptVersion ?? null,
    ok: e.ok,
    fallback_used: e.fallbackUsed,
    input_tokens: e.inputTokens,
    output_tokens: e.outputTokens,
    latency_ms: e.latencyMs,
    error: e.error ?? null,
  });
}
