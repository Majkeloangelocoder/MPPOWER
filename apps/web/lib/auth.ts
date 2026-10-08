import { HttpError } from './http';
import { supabaseAdmin } from './supabase-admin';

/** Weryfikuje token z nagłówka Authorization: Bearer <access_token> (sesja Supabase z aplikacji). */
export async function requireUser(req: Request): Promise<{ userId: string }> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'unauthorized', 'Zaloguj się ponownie.');
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'unauthorized', 'Sesja wygasła — zaloguj się ponownie.');
  return { userId: data.user.id as string };
}
