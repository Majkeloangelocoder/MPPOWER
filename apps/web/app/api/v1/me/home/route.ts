import { requireUser } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { getHome } from '@/lib/profile';

export const runtime = 'nodejs';

/** Ekran Dziś: aktywny plan (spersonalizowany lub ogólny), tydzień cyklu i kompletność profilu. */
export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    return json(await getHome(userId));
  });
}
