import type { ApiErrorBody } from '@mp-power/core';
import { supabase } from './supabase';

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

const API_URL = process.env.EXPO_PUBLIC_API_URL;

function defaultMessage(status: number): string {
  if (status === 401) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (status === 402) return 'Ta funkcja jest dostępna w wyższym planie.';
  if (status === 404) return 'Nie znaleziono danych na serwerze.';
  if (status === 429) return 'Wykorzystany limit — spróbuj później.';
  return 'Serwer nie odpowiedział poprawnie. Spróbuj ponownie za chwilę.';
}

/** Wywołanie API z tokenem sesji Supabase; błędy zamienione na komunikaty dla użytkownika. */
export async function apiFetch<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'config', 'Brak adresu API (EXPO_PUBLIC_API_URL w pliku .env).');
  const { data } = await supabase.auth.getSession();
  const token: string | undefined = data.session?.access_token;
  if (!token) throw new ApiError(401, 'unauthorized', defaultMessage(401));

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
  }

  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'http_error', error?.message ?? defaultMessage(res.status));
  }
  return payload as T;
}

export function messageForError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Serwer nie odpowiedział poprawnie. Spróbuj ponownie za chwilę.';
}
