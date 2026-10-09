import { requireUser } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { generatePlan } from '@/lib/profile';

export const runtime = 'nodejs';

/** Projektuje plan na cykl 8 tygodni z profilu i pomiarów; wymaga kompletnego profilu (409 w przeciwnym razie). */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    return json(await generatePlan(userId), 201);
  });
}
