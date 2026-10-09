import { DemoHttpError, handle } from './server';

/** Zamiennik src/lib/api.ts w trybie demo (EXPO_PUBLIC_DEMO=1): zapytania obsługuje serwer w przeglądarce. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  // Krótkie opóźnienie, żeby stany ładowania wyglądały jak w prawdziwej aplikacji.
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    return structuredClone(handle(init.method ?? 'GET', path, init.body)) as T;
  } catch (err) {
    if (err instanceof DemoHttpError) throw new ApiError(err.status, err.code, err.message);
    throw new ApiError(500, 'demo_error', 'Coś poszło nie tak w wersji demo.');
  }
}

export function messageForError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Serwer nie odpowiedział poprawnie. Spróbuj ponownie za chwilę.';
}
