import {
  currentCycleWeek,
  generateCyclePlan,
  profileCompleteness,
  ProfileIncompleteError,
  type CircumferenceKind,
  type Circumferences,
  type CyclePhase,
  type GeneratePlanResponse,
  type HomeCycle,
  type HomeResponse,
  type LibraryExercise,
  type Limitation,
  type OnboardingProfile,
  type PhotoPose,
  type ProfileResponse,
  type TrainingGoal,
  type UpdateProfileRequest,
  type WeekPlan,
} from '@mp-power/core';
import { HttpError } from './http';
import { supabaseAdmin } from './supabase-admin';

const db = () => supabaseAdmin();
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const CIRCUMFERENCE_KINDS: readonly CircumferenceKind[] = ['waist', 'abdomen', 'chest', 'arm', 'thigh', 'hips'];
const PHOTO_URL_TTL_SECONDS = 3600;
const CONSENT_VERSION = '2026-10';

// ---------------------------------------------------------------------------
// Odczyt profilu
// ---------------------------------------------------------------------------

async function latestConsents(userId: string): Promise<{ healthData: boolean; bodyImages: boolean }> {
  const { data, error } = await db()
    .from('consents')
    .select('consent_type, granted')
    .eq('user_id', userId)
    .in('consent_type', ['health_data', 'body_images'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  const latest = new Map<string, boolean>();
  for (const r of (data ?? []) as Array<{ consent_type: string; granted: boolean }>) {
    if (!latest.has(r.consent_type)) latest.set(r.consent_type, r.granted);
  }
  return { healthData: latest.get('health_data') ?? false, bodyImages: latest.get('body_images') ?? false };
}

export async function loadOnboardingProfile(userId: string): Promise<OnboardingProfile> {
  const [profile, goal, measurements, limitations] = await Promise.all([
    db()
      .from('profiles')
      .select('sex_for_calc, birth_year, height_cm, experience_level, training_location, home_equipment, days_per_week, session_minutes')
      .eq('id', userId)
      .maybeSingle(),
    db().from('goals').select('goal_type').eq('user_id', userId).eq('is_primary', true).eq('status', 'active').maybeSingle(),
    db()
      .from('measurements')
      .select('kind, value, measured_at')
      .eq('user_id', userId)
      .order('measured_at', { ascending: false })
      .limit(100),
    db().from('user_limitations').select('body_region').eq('user_id', userId),
  ]);
  for (const r of [profile, goal, measurements, limitations]) if (r.error) throw r.error;

  const p = profile.data as Record<string, unknown> | null;
  const circumferences: Circumferences = {};
  let weightKg: number | null = null;
  for (const m of (measurements.data ?? []) as Array<{ kind: string; value: number }>) {
    if (m.kind === 'body_weight') weightKg ??= Number(m.value);
    else if ((CIRCUMFERENCE_KINDS as readonly string[]).includes(m.kind)) {
      const kind = m.kind as CircumferenceKind;
      circumferences[kind] ??= Number(m.value);
    }
  }
  const goalType = (goal.data as { goal_type: string } | null)?.goal_type;
  return {
    goal: goalType && ['fat_loss', 'muscle_gain', 'strength', 'fitness'].includes(goalType) ? (goalType as TrainingGoal) : null,
    level: (p?.experience_level as OnboardingProfile['level']) ?? null,
    sex: (p?.sex_for_calc as OnboardingProfile['sex']) ?? null,
    birthYear: num(p?.birth_year),
    heightCm: num(p?.height_cm),
    weightKg,
    daysPerWeek: num(p?.days_per_week),
    sessionMinutes: num(p?.session_minutes),
    location: p?.training_location === 'gym' || p?.training_location === 'home' ? p.training_location : null,
    homeEquipment: (p?.home_equipment as OnboardingProfile['homeEquipment']) ?? null,
    limitations: ((limitations.data ?? []) as Array<{ body_region: string }>).map((l) => l.body_region as Limitation),
    circumferences,
  };
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  const [profile, consents, photos] = await Promise.all([
    loadOnboardingProfile(userId),
    latestConsents(userId),
    db().from('progress_photos').select('id, pose, storage_path, taken_at').eq('user_id', userId).order('taken_at', { ascending: false }).limit(30),
  ]);
  if (photos.error) throw photos.error;
  const rows = (photos.data ?? []) as Array<{ id: string; pose: PhotoPose; storage_path: string; taken_at: string }>;
  const signed = rows.length
    ? await db().storage.from('body-photos').createSignedUrls(rows.map((r) => r.storage_path), PHOTO_URL_TTL_SECONDS)
    : { data: [], error: null };
  if (signed.error) throw signed.error;
  const urls = new Map((signed.data ?? []).map((s: { path: string | null; signedUrl: string | null }) => [s.path, s.signedUrl]));
  return {
    profile,
    completeness: profileCompleteness(profile),
    consents,
    photos: rows.map((r) => ({ id: r.id, pose: r.pose, takenAt: r.taken_at, url: urls.get(r.storage_path) ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Zapis kroku ankiety
// ---------------------------------------------------------------------------

export async function updateProfile(userId: string, req: UpdateProfileRequest): Promise<ProfileResponse> {
  const current = await loadOnboardingProfile(userId);
  const consents = await latestConsents(userId);

  // Zgody najpierw: od nich zależy, czy wolno zapisać ograniczenia zdrowotne.
  const consentRows: Array<{ user_id: string; consent_type: string; document_version: string; granted: boolean; source: string }> = [];
  if (req.consents?.healthData !== undefined && req.consents.healthData !== consents.healthData) {
    consentRows.push({ user_id: userId, consent_type: 'health_data', document_version: CONSENT_VERSION, granted: req.consents.healthData, source: 'app' });
    consents.healthData = req.consents.healthData;
  }
  if (req.consents?.bodyImages !== undefined && req.consents.bodyImages !== consents.bodyImages) {
    consentRows.push({ user_id: userId, consent_type: 'body_images', document_version: CONSENT_VERSION, granted: req.consents.bodyImages, source: 'app' });
    consents.bodyImages = req.consents.bodyImages;
  }
  if (consentRows.length) {
    const { error } = await db().from('consents').insert(consentRows);
    if (error) throw error;
  }

  const patch: Record<string, unknown> = {};
  if (req.sex !== undefined) patch.sex_for_calc = req.sex;
  if (req.birthYear !== undefined) patch.birth_year = req.birthYear;
  if (req.heightCm !== undefined) patch.height_cm = req.heightCm;
  if (req.level !== undefined) patch.experience_level = req.level;
  if (req.location !== undefined) patch.training_location = req.location;
  if (req.homeEquipment !== undefined) patch.home_equipment = req.homeEquipment;
  if (req.daysPerWeek !== undefined) patch.days_per_week = req.daysPerWeek;
  if (req.sessionMinutes !== undefined) patch.session_minutes = req.sessionMinutes;
  if (Object.keys(patch).length) {
    const { error } = await db().from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
  }

  if (req.goal && req.goal !== current.goal) {
    const done = await db().from('goals').update({ status: 'abandoned', is_primary: false }).eq('user_id', userId).eq('is_primary', true).eq('status', 'active');
    if (done.error) throw done.error;
    const { error } = await db().from('goals').insert({ user_id: userId, goal_type: req.goal, is_primary: true });
    if (error) throw error;
  }

  // Pomiar zapisujemy tylko, gdy wartość się zmieniła — historia obwodów zostaje czytelna.
  const measurements: Array<{ user_id: string; kind: string; value: number; source: string }> = [];
  if (req.weightKg != null && req.weightKg !== current.weightKg) measurements.push({ user_id: userId, kind: 'body_weight', value: req.weightKg, source: 'manual' });
  for (const kind of CIRCUMFERENCE_KINDS) {
    const value = req.circumferences?.[kind];
    if (value != null && value !== current.circumferences?.[kind]) measurements.push({ user_id: userId, kind, value, source: 'manual' });
  }
  if (measurements.length) {
    const { error } = await db().from('measurements').insert(measurements);
    if (error) throw error;
  }

  // Ograniczenia (kontuzje) to dane o zdrowiu: zapis tylko ze zgodą 'health_data'.
  if (req.limitations !== undefined) {
    if (req.limitations.length > 0 && !consents.healthData) {
      throw new HttpError(403, 'consent_required', 'Aby uwzględnić kontuzje, potrzebujemy zgody na przetwarzanie danych o zdrowiu.');
    }
    const del = await db().from('user_limitations').delete().eq('user_id', userId);
    if (del.error) throw del.error;
    if (req.limitations.length) {
      const { error } = await db()
        .from('user_limitations')
        .insert([...new Set(req.limitations)].map((body_region) => ({ user_id: userId, body_region })));
      if (error) throw error;
    }
  }

  return getProfile(userId);
}

// ---------------------------------------------------------------------------
// Ekran główny: aktywny plan (spersonalizowany) albo plan ogólny
// ---------------------------------------------------------------------------

interface WeekRow {
  week_index: number;
  phase: CyclePhase;
  label: string;
  sets_delta: number;
  sets_multiplier: number;
  rir_delta: number;
  hold_progression: boolean;
  check_in: boolean;
  focus: string | null;
}

export function toWeekPlan(r: WeekRow): WeekPlan {
  return {
    weekIndex: r.week_index,
    phase: r.phase,
    label: r.label,
    setsDelta: Number(r.sets_delta),
    setsMultiplier: Number(r.sets_multiplier),
    rirDelta: Number(r.rir_delta),
    holdProgression: r.hold_progression,
    checkIn: r.check_in,
    focus: r.focus ?? '',
  };
}

export async function loadWeekPlan(programId: string, week: number | null): Promise<WeekPlan | null> {
  if (week === null) return null;
  const { data, error } = await db().from('program_weeks').select('*').eq('program_id', programId).eq('week_index', week).maybeSingle();
  if (error) throw error;
  return data ? toWeekPlan(data as WeekRow) : null;
}

export function toHomeCycle(week: WeekPlan, totalWeeks: number): HomeCycle {
  return { week: week.weekIndex, totalWeeks, phase: week.phase, label: week.label, focus: week.focus || null, checkIn: week.checkIn };
}

async function loadDays(programId: string) {
  const { data, error } = await db()
    .from('program_days')
    .select('id, day_index, title, focus, estimated_minutes')
    .eq('program_id', programId)
    .order('day_index');
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; day_index: number; title: string; focus: string | null; estimated_minutes: number | null }>).map((d) => ({
    id: d.id,
    dayIndex: d.day_index,
    title: d.title,
    focus: d.focus,
    estimatedMinutes: d.estimated_minutes,
  }));
}

export async function getHome(userId: string, now = new Date()): Promise<HomeResponse> {
  const profile = await loadOnboardingProfile(userId);
  const completeness = profileCompleteness(profile, now);

  const active = await db()
    .from('user_programs')
    .select('started_at, programs!inner(id, title, cycle_weeks, generator_inputs)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (active.error) throw active.error;

  if (active.data) {
    const program = (active.data as unknown as { started_at: string; programs: { id: string; title: string; cycle_weeks: number | null; generator_inputs: { insights?: string[] } | null } }).programs;
    const startedAt = (active.data as { started_at: string }).started_at;
    const weekPlan = program.cycle_weeks ? await loadWeekPlan(program.id, currentCycleWeek(startedAt, now, program.cycle_weeks)) : null;
    return {
      completeness,
      program: {
        id: program.id,
        title: program.title,
        kind: 'personal',
        cycle: weekPlan && program.cycle_weeks ? toHomeCycle(weekPlan, program.cycle_weeks) : null,
        insights: program.generator_inputs?.insights ?? [],
        days: await loadDays(program.id),
      },
    };
  }

  // Bez profilu: plan ogólny dla każdego (opublikowany szablon w planie FREE).
  const template = await db()
    .from('programs')
    .select('id, title')
    .not('org_id', 'is', null)
    .eq('status', 'published')
    .eq('required_plan', 'free')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (template.error) throw template.error;
  if (!template.data) return { completeness, program: null };
  const t = template.data as { id: string; title: string };
  return { completeness, program: { id: t.id, title: t.title, kind: 'general', cycle: null, insights: [], days: await loadDays(t.id) } };
}

// ---------------------------------------------------------------------------
// Projektowanie planu na cykl
// ---------------------------------------------------------------------------

async function loadLibrary(userId: string): Promise<LibraryExercise[]> {
  const [rank, plans] = await Promise.all([
    db().rpc('plan_rank_for', { p_user: userId }),
    db().from('plans').select('code, rank'),
  ]);
  if (rank.error) throw rank.error;
  if (plans.error) throw plans.error;
  const allowed = ((plans.data ?? []) as Array<{ code: string; rank: number }>).filter((p) => p.rank <= Number(rank.data)).map((p) => p.code);
  const { data, error } = await db()
    .from('exercises')
    .select('id, name_pl, category, plane, primary_muscles, equipment, difficulty, load_type, stress_tags')
    .eq('is_published', true)
    .in('required_plan', allowed);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as string,
    name: e.name_pl as string,
    category: e.category as LibraryExercise['category'],
    plane: (e.plane as LibraryExercise['plane']) ?? null,
    primaryMuscles: (e.primary_muscles as string[]) ?? [],
    equipment: (e.equipment as string[]) ?? [],
    difficulty: Number(e.difficulty),
    loadType: e.load_type as LibraryExercise['loadType'],
    stressTags: (e.stress_tags as string[]) ?? [],
  }));
}

export async function generatePlan(userId: string, now = new Date()): Promise<GeneratePlanResponse> {
  const [profile, library] = await Promise.all([loadOnboardingProfile(userId), loadLibrary(userId)]);
  let plan;
  try {
    plan = generateCyclePlan(profile, library, now);
  } catch (err) {
    if (err instanceof ProfileIncompleteError) {
      throw new HttpError(409, 'profile_incomplete', `${err.message} Brakuje: ${err.missing.join(', ')}.`);
    }
    throw err;
  }
  const { data, error } = await db().rpc('assign_generated_program', { p_user_id: userId, p_program: plan.program, p_inputs: profile });
  if (error) throw error;
  return { programId: data as string, program: plan.program, nutrition: plan.nutrition };
}
