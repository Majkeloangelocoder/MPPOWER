import { ZodError } from 'zod';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Jednolite odpowiedzi błędów: { error: { code, message } }; szczegóły wewnętrzne tylko w logach. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof ZodError) {
      return json(
        { error: { code: 'invalid_request', message: 'Nieprawidłowe dane.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        400,
      );
    }
    console.error('[api] unexpected error', err);
    return json({ error: { code: 'internal_error', message: 'Coś poszło nie tak po naszej stronie.' } }, 500);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Treść żądania nie jest poprawnym JSON.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(value: string): string {
  if (!UUID.test(value)) throw new HttpError(400, 'invalid_id', 'Nieprawidłowy identyfikator.');
  return value;
}
