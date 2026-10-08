import type { EntitlementsResponse } from '@mp-power/core';
import { requireUser } from '@/lib/auth';
import { getEntitlements } from '@/lib/entitlements';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';

/** Aplikacja tylko wyświetla uprawnienia — decyzje o dostępie zapadają na serwerze. */
export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const e = await getEntitlements(userId);
    const body: EntitlementsResponse = { planCode: e.planCode, validUntil: e.validUntil, inGracePeriod: e.inGracePeriod, features: e.features };
    return json(body);
  });
}
