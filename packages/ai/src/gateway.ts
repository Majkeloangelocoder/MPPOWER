import type { AIProvider, GenerateRequest, GenerateResult } from './types.ts';

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface TaskPolicy {
  primary: ModelRoute;
  fallback?: ModelRoute;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  promptVersion?: string;
}

export interface UsageEvent {
  task: string;
  provider: string;
  model: string;
  ok: boolean;
  fallbackUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
  userId?: string;
  promptVersion?: string;
}

export type TaskRequest = Omit<GenerateRequest, 'model' | 'maxTokens' | 'timeoutMs'> & { userId?: string };

/**
 * Jedno wejście do modeli dla całej aplikacji: zadanie → polityka (model, limit tokenów, czas)
 * → dostawca główny, a przy błędzie zapasowy. Każde wywołanie trafia do logu kosztów.
 */
export class AIGateway {
  private readonly providers: Readonly<Record<string, AIProvider>>;
  private readonly policies: Readonly<Record<string, TaskPolicy>>;
  private readonly onUsage: ((event: UsageEvent) => void | Promise<void>) | undefined;

  constructor(opts: {
    providers: Record<string, AIProvider>;
    policies: Record<string, TaskPolicy>;
    onUsage?: (event: UsageEvent) => void | Promise<void>;
  }) {
    this.providers = opts.providers;
    this.policies = opts.policies;
    this.onUsage = opts.onUsage;
  }

  async run(task: string, req: TaskRequest): Promise<GenerateResult> {
    const policy = this.policies[task];
    if (!policy) throw new Error(`Unknown AI task: ${task}`);
    const routes = policy.fallback ? [policy.primary, policy.fallback] : [policy.primary];
    const { userId, ...request } = req;
    let lastError: unknown = new Error(`No provider configured for task ${task}`);

    for (const [index, route] of routes.entries()) {
      const provider = this.providers[route.provider];
      if (!provider) {
        lastError = new Error(`Provider not configured: ${route.provider}`);
        continue;
      }
      const started = Date.now();
      try {
        const result = await provider.generate({
          ...request,
          model: route.model,
          maxTokens: policy.maxTokens,
          timeoutMs: policy.timeoutMs,
          temperature: request.temperature ?? policy.temperature,
        });
        await this.report({
          task, provider: route.provider, model: route.model, ok: true, fallbackUsed: index > 0,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs, userId, promptVersion: policy.promptVersion,
        });
        return result;
      } catch (err) {
        lastError = err;
        await this.report({
          task, provider: route.provider, model: route.model, ok: false, fallbackUsed: index > 0,
          inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err), userId, promptVersion: policy.promptVersion,
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async report(event: UsageEvent): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage(event);
    } catch {
      // Logowanie kosztów nie może zatrzymać odpowiedzi dla użytkownika.
    }
  }
}
