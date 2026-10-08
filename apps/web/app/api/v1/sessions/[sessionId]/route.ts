import { requireUser } from '@/lib/auth';
import { handle, json, parseUuid } from '@/lib/http';
import { buildPlayerPayload } from '@/lib/workouts';

export const runtime = 'nodejs';

/** Wznowienie treningu po zamknięciu aplikacji: ten sam payload co przy starcie. */
export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const { sessionId } = await ctx.params;
    return json(await buildPlayerPayload(userId, parseUuid(sessionId)));
  });
}
