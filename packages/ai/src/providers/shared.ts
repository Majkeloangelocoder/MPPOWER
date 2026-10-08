import { AIProviderError, type GenerateRequest, type GenerateResult } from '../types.ts';

function errorMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') return error.message;
  }
  return null;
}

/** POST JSON z limitem czasu; błędy HTTP i sieci zamienia na AIProviderError (429 i 5xx = do ponowienia). */
export async function postJson(
  fetchImpl: typeof fetch,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new AIProviderError(provider, res.status, errorMessage(data) ?? `HTTP ${res.status}`, res.status === 429 || res.status >= 500);
    }
    return data;
  } catch (err) {
    if (err instanceof AIProviderError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AIProviderError(provider, 0, `timeout after ${timeoutMs} ms`, true);
    }
    throw new AIProviderError(provider, 0, err instanceof Error ? err.message : 'network error', true);
  } finally {
    clearTimeout(timer);
  }
}

/** Uzupełnia wynik o sparsowany JSON, gdy żądanie wymagało ustrukturyzowanej odpowiedzi. */
export function finalize(result: GenerateResult, req: GenerateRequest): GenerateResult {
  if (!req.jsonSchema) return result;
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch {
    throw new AIProviderError(result.provider, 200, `invalid JSON in structured output (stop: ${result.stopReason ?? 'unknown'})`, true);
  }
}
