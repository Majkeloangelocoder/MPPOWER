import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { startSession } from '@/lib/workouts';

export const runtime = 'nodejs';

const StartBody = z.object({
  programDayId: z.string().uuid(),
  clientSessionId: z.string().uuid(),
});

/** START WORKOUT — tworzy sesję (idempotentnie) i zwraca payload dla Workout Player. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const body = StartBody.parse(await readJson(req));
    return json(await startSession(userId, body.programDayId, body.clientSessionId), 201);
  });
}
