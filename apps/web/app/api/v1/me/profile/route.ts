import { PROFILE_LIMITS } from '@mp-power/core';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getProfile, updateProfile } from '@/lib/profile';

export const runtime = 'nodejs';

const range = ([min, max]: readonly [number, number]) => z.number().min(min).max(max);
const circumference = range(PROFILE_LIMITS.circumference).optional();

const UpdateBody = z.object({
  goal: z.enum(['fat_loss', 'muscle_gain', 'strength', 'fitness']).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  sex: z.enum(['female', 'male', 'unspecified']).optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear() - 18).optional(),
  heightCm: range(PROFILE_LIMITS.heightCm).optional(),
  weightKg: range(PROFILE_LIMITS.weightKg).optional(),
  daysPerWeek: z.number().int().min(PROFILE_LIMITS.daysPerWeek[0]).max(PROFILE_LIMITS.daysPerWeek[1]).optional(),
  sessionMinutes: z.number().int().min(PROFILE_LIMITS.sessionMinutes[0]).max(PROFILE_LIMITS.sessionMinutes[1]).optional(),
  location: z.enum(['gym', 'home']).optional(),
  homeEquipment: z.enum(['none', 'dumbbells']).optional(),
  limitations: z.array(z.enum(['knee', 'shoulder', 'lower_back', 'wrist'])).max(4).optional(),
  circumferences: z
    .object({ waist: circumference, abdomen: circumference, chest: circumference, arm: circumference, thigh: circumference, hips: circumference })
    .optional(),
  consents: z.object({ healthData: z.boolean().optional(), bodyImages: z.boolean().optional() }).optional(),
});

/** Profil startowy: dane, pomiary, zgody i zdjęcia sylwetki (podpisane adresy). */
export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    return json(await getProfile(userId));
  });
}

/** Zapis kroku ankiety — tylko przesłane pola. */
export async function PUT(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const body = UpdateBody.parse(await readJson(req));
    return json(await updateProfile(userId, body));
  });
}
