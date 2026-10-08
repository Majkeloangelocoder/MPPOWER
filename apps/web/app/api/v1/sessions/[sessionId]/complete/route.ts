import type { CompleteSessionRequest } from '@mp-power/core';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, parseUuid, readJson } from '@/lib/http';
import { completeSession } from '@/lib/workouts';

export const runtime = 'nodejs';

const SetSchema = z.object({
  sessionExerciseId: z.string().uuid(),
  setIndex: z.number().int().min(1).max(30),
  setType: z.enum(['warmup', 'working', 'backoff']).optional(),
  loadKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(600),
  rir: z.number().min(0).max(10).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  completed: z.boolean(),
});

const CompleteBody = z.object({
  sets: z.array(SetSchema).max(300),
  skippedSessionExerciseIds: z.array(z.string().uuid()).max(50).optional(),
  swaps: z.array(z.object({ sessionExerciseId: z.string().uuid(), exerciseId: z.string().uuid() })).max(50).optional(),
  sessionRpe: z.number().min(1).max(10).nullable().optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});

/** Koniec treningu → silnik progresji → AI Review → cele na następny raz. */
export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const { sessionId } = await ctx.params;
    const body: CompleteSessionRequest = CompleteBody.parse(await readJson(req));
    return json(await completeSession(userId, parseUuid(sessionId), body));
  });
}
