import {
  applyWeek,
  assessReadiness,
  fitTargetToSets,
  countNewRecords,
  detectRecords,
  hasFeature,
  recommendNext,
  scoreSession,
  type CompleteSessionRequest,
  type CompleteSessionResponse,
  type ExerciseExposure,
  type ExperienceLevel,
  type LoadType,
  type LoggedSet,
  type NextTarget,
  type PersonalRecord,
  type PlayerPayload,
  type Prescription,
  type PreviousBests,
  type ProgressionModel,
  type Readiness,
  type RecordKind,
  type Recommendation,
  type ReviewRecord,
  type ReviewTarget,
  type ScoredExercise,
  type WeekPlan,
} from '@mp-power/core';
import { generateSessionReview } from '@mp-power/ai';
import { aiGateway } from './ai';
import { getEntitlements } from './entitlements';
import { loadWeekPlan, toHomeCycle } from './profile';
import { HttpError } from './http';
import { supabaseAdmin } from './supabase-admin';

const DEFAULT_REST_SECONDS = 90;
const HISTORY_PER_EXERCISE = 6;

interface SessionRow {
  id: string;
  title: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: string;
  review: StoredReview | null;
  cycle_week: number | null;
  program_day_id: string | null;
}
interface SessionExerciseRow {
  id: string;
  exercise_id: string;
  program_exercise_id: string | null;
  order_index: number;
  skipped: boolean;
}
interface ExerciseRow {
  id: string;
  name_pl: string;
  load_type: LoadType;
  default_increment_kg: number;
}
interface PrescriptionRow {
  id: string;
  sets: number;
  rep_min: number;
  rep_max: number;
  target_rir: number;
  rest_seconds: number | null;
  tempo: string | null;
  progression_model: ProgressionModel;
  max_sets: number | null;
  notes: string | null;
  block: 'warmup' | 'main' | 'accessory' | 'finisher';
}
type StoredReview = Omit<CompleteSessionResponse, 'sessionId' | 'alreadyCompleted'>;

const db = () => supabaseAdmin();
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function mapRpcError(error: { code?: string; message: string }): Error {
  if (error.code === 'P0002') return new HttpError(404, 'not_found', 'Nie znaleziono treningu lub dnia programu.');
  if (error.code === '42501') return new HttpError(403, 'program_not_available', 'Ten program nie jest dostępny w Twoim planie.');
  if (error.code === '22023') return new HttpError(409, error.message, 'Nie można zapisać tego treningu w obecnym stanie.');
  return new Error(error.message);
}

// ---------------------------------------------------------------------------
// Odczyty
// ---------------------------------------------------------------------------

async function loadSession(userId: string, sessionId: string): Promise<SessionRow> {
  const { data, error } = await db()
    .from('workout_sessions')
    .select('id, title, status, started_at, review, cycle_week, program_day_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'session_not_found', 'Nie znaleziono treningu.');
  return data as SessionRow;
}

async function loadSessionExercises(userId: string, sessionId: string): Promise<SessionExerciseRow[]> {
  const { data, error } = await db()
    .from('session_exercises')
    .select('id, exercise_id, program_exercise_id, order_index, skipped')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('order_index');
  if (error) throw error;
  return (data ?? []) as SessionExerciseRow[];
}

async function loadExercises(ids: string[]): Promise<Map<string, ExerciseRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db().from('exercises').select('id, name_pl, load_type, default_increment_kg').in('id', ids);
  if (error) throw error;
  return new Map(
    (data ?? []).map((e: ExerciseRow) => [e.id, { ...e, default_increment_kg: Number(e.default_increment_kg) }] as const),
  );
}

async function loadPrescriptions(ids: string[]): Promise<Map<string, PrescriptionRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db()
    .from('program_exercises')
    .select('id, sets, rep_min, rep_max, target_rir, rest_seconds, tempo, progression_model, max_sets, notes, block')
    .in('id', ids);
  if (error) throw error;
  return new Map((data ?? []).map((p: PrescriptionRow) => [p.id, { ...p, target_rir: Number(p.target_rir) }] as const));
}

/** Trudniejsze warianty (exercise_relations: progression) dla ćwiczeń z masą ciała i na czas. */
async function loadProgressionVariants(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db()
    .from('exercise_relations')
    .select('exercise_id, related_exercise_id, priority')
    .eq('relation', 'progression')
    .in('exercise_id', ids)
    .order('priority');
  if (error) throw error;
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ exercise_id: string; related_exercise_id: string }>) {
    if (!out.has(r.exercise_id)) out.set(r.exercise_id, r.related_exercise_id);
  }
  return out;
}

function readNextTarget(value: unknown): NextTarget | null {
  const next = value && typeof value === 'object' ? (value as { next?: unknown }).next : null;
  if (!next || typeof next !== 'object') return null;
  const n = next as Record<string, unknown>;
  const ok =
    typeof n.exerciseId === 'string' &&
    typeof n.sets === 'number' &&
    typeof n.repMin === 'number' &&
    typeof n.repMax === 'number' &&
    typeof n.targetRir === 'number' &&
    Array.isArray(n.repsPerSet) &&
    (n.loadKg === null || typeof n.loadKg === 'number');
  return ok ? (next as NextTarget) : null;
}

/** Ostatni cel na ćwiczenie; nadpisanie trenera (status overridden) zawsze wygrywa z silnikiem. */
async function loadLatestTargets(userId: string, exerciseIds: string[]): Promise<Map<string, { next: NextTarget; explanation: string }>> {
  const out = new Map<string, { next: NextTarget; explanation: string }>();
  if (exerciseIds.length === 0) return out;
  const { data, error } = await db()
    .from('ai_recommendations')
    .select('exercise_id, status, payload, override_payload, explanation, override_note')
    .eq('user_id', userId)
    .eq('kind', 'progression')
    .in('status', ['proposed', 'accepted', 'overridden'])
    .in('exercise_id', exerciseIds)
    .order('created_at', { ascending: false })
    .limit(Math.max(50, exerciseIds.length * 5));
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ exercise_id: string; status: string; payload: unknown; override_payload: unknown; explanation: string; override_note: string | null }>) {
    if (out.has(row.exercise_id)) continue;
    const overridden = row.status === 'overridden' && row.override_payload;
    const next = readNextTarget(overridden ? row.override_payload : row.payload);
    if (next) out.set(row.exercise_id, { next, explanation: overridden ? row.override_note ?? row.explanation : row.explanation });
  }
  return out;
}

async function loadHistory(userId: string, exerciseIds: string[], excludeSessionId: string): Promise<Map<string, ExerciseExposure[]>> {
  const out = new Map<string, ExerciseExposure[]>();
  if (exerciseIds.length === 0) return out;
  const { data, error } = await db().rpc('exercise_history', {
    p_user_id: userId,
    p_exercise_ids: exerciseIds,
    p_exclude_session: excludeSessionId,
    p_per_exercise: HISTORY_PER_EXERCISE,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ exercise_id: string; session_id: string; performed_at: string; sets: Array<Record<string, unknown>> }>) {
    const list = out.get(row.exercise_id) ?? [];
    list.push({
      sessionId: row.session_id,
      performedAt: row.performed_at,
      sets: row.sets.map((s) => ({
        loadKg: num(s.loadKg),
        reps: Number(s.reps),
        rir: num(s.rir),
        rpe: num(s.rpe),
        completed: Boolean(s.completed),
      })),
    });
    out.set(row.exercise_id, list);
  }
  return out;
}

async function loadPreviousBests(userId: string, exerciseIds: string[]): Promise<Map<string, PreviousBests>> {
  const out = new Map<string, PreviousBests>();
  if (exerciseIds.length === 0) return out;
  const { data, error } = await db()
    .from('personal_records')
    .select('exercise_id, kind, value')
    .eq('user_id', userId)
    .in('exercise_id', exerciseIds);
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ exercise_id: string; kind: RecordKind; value: number }>) {
    const bests = out.get(r.exercise_id) ?? {};
    const value = Number(r.value);
    if (bests[r.kind] === undefined || value > (bests[r.kind] as number)) bests[r.kind] = value;
    out.set(r.exercise_id, bests);
  }
  return out;
}

async function loadReadiness(userId: string, now: Date): Promise<Readiness> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db()
    .from('recovery_logs')
    .select('log_date, sleep_hours, fatigue')
    .eq('user_id', userId)
    .gte('log_date', since);
  if (error) throw error;
  const entries = (data ?? []).map((r: { log_date: string; sleep_hours: number | null; fatigue: number | null }) => ({
    date: r.log_date,
    sleepHours: num(r.sleep_hours),
    fatigue: num(r.fatigue),
  }));
  return assessReadiness(entries, now.toISOString());
}

async function loadLevel(userId: string): Promise<ExperienceLevel> {
  const { data, error } = await db().from('profiles').select('experience_level').eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data?.experience_level as ExperienceLevel | null) ?? 'beginner';
}

function toPrescription(exerciseId: string, meta: ExerciseRow, row: PrescriptionRow | undefined, variant: string | undefined): Prescription {
  const loadIncrementKg = meta.load_type === 'external' ? (meta.default_increment_kg > 0 ? meta.default_increment_kg : 2.5) : 0;
  const base = { exerciseId, loadType: meta.load_type, loadIncrementKg, progressionExerciseId: variant ?? null };
  if (!row) return { ...base, sets: 3, repMin: 8, repMax: 12, targetRir: 2, model: 'double_progression' };
  return {
    ...base,
    sets: row.sets,
    repMin: row.rep_min,
    repMax: row.rep_max,
    targetRir: row.target_rir,
    model: row.progression_model,
    maxSets: row.max_sets ?? undefined,
  };
}

/** Tydzień cyklu zapisany przy starcie sesji (tylko plan spersonalizowany). */
async function loadSessionWeek(session: SessionRow): Promise<{ week: WeekPlan; totalWeeks: number } | null> {
  if (session.cycle_week === null || !session.program_day_id) return null;
  const { data, error } = await db()
    .from('program_days')
    .select('program_id, programs!inner(cycle_weeks)')
    .eq('id', session.program_day_id)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as { program_id: string; programs: { cycle_weeks: number | null } } | null;
  if (!row?.programs.cycle_weeks) return null;
  const week = await loadWeekPlan(row.program_id, session.cycle_week);
  return week ? { week, totalWeeks: row.programs.cycle_weeks } : null;
}

/** Recepta na tydzień cyklu: serie i zapas RIR według fazy (np. mniej serii w odciążeniu). */
function forWeek(p: Prescription, row: PrescriptionRow | undefined, week: WeekPlan | null): Prescription {
  if (!week) return p;
  const block = row?.block === 'accessory' || row?.block === 'finisher' ? row.block : 'main';
  const w = applyWeek({ sets: p.sets, targetRir: p.targetRir, block }, week);
  return { ...p, sets: w.sets, targetRir: w.targetRir };
}

// ---------------------------------------------------------------------------
// Komendy
// ---------------------------------------------------------------------------

export async function buildPlayerPayload(userId: string, sessionId: string): Promise<PlayerPayload> {
  const session = await loadSession(userId, sessionId);
  const rows = (await loadSessionExercises(userId, sessionId)).filter((r) => !r.skipped);
  const exerciseIds = unique(rows.map((r) => r.exercise_id));
  const [meta, prescriptions, targets, cycle] = await Promise.all([
    loadExercises(exerciseIds),
    loadPrescriptions(unique(rows.flatMap((r) => (r.program_exercise_id ? [r.program_exercise_id] : [])))),
    loadLatestTargets(userId, exerciseIds),
    loadSessionWeek(session),
  ]);

  return {
    sessionId: session.id,
    title: session.title,
    startedAt: session.started_at,
    cycle: cycle ? toHomeCycle(cycle.week, cycle.totalWeeks) : null,
    exercises: rows.map((r) => {
      const m = meta.get(r.exercise_id);
      if (!m) throw new Error(`Exercise ${r.exercise_id} not found`);
      const row = r.program_exercise_id ? prescriptions.get(r.program_exercise_id) : undefined;
      const p = forWeek(toPrescription(r.exercise_id, m, row, undefined), row, cycle?.week ?? null);
      const latest = targets.get(r.exercise_id);
      const target = latest && latest.next.exerciseId === r.exercise_id ? latest.next : null;
      return {
        sessionExerciseId: r.id,
        exerciseId: r.exercise_id,
        name: m.name_pl,
        loadType: m.load_type,
        orderIndex: r.order_index,
        prescription: {
          sets: p.sets,
          repMin: p.repMin,
          repMax: p.repMax,
          targetRir: p.targetRir,
          restSeconds: row?.rest_seconds ?? DEFAULT_REST_SECONDS,
          tempo: row?.tempo ?? null,
          model: p.model,
          notes: row?.notes ?? null,
        },
        target: target && cycle ? fitTargetToSets(target, p.sets) : target,
        why: latest?.explanation ?? null,
      };
    }),
  };
}

/** START WORKOUT: idempotentnie tworzy sesję (funkcja SQL sprawdza dostęp do programu) i zwraca payload. */
export async function startSession(userId: string, programDayId: string, clientSessionId: string): Promise<PlayerPayload> {
  const { data, error } = await db().rpc('start_workout_session', {
    p_user_id: userId,
    p_program_day_id: programDayId,
    p_client_session_id: clientSessionId,
  });
  if (error) throw mapRpcError(error);
  return buildPlayerPayload(userId, data as string);
}

/**
 * Koniec treningu = serce pętli: zapis serii → silnik progresji → rekordy → ocena →
 * AI Review (lub reguły) → atomowy zapis w funkcji SQL. Ponowne wysłanie zwraca ten sam wynik.
 */
export async function completeSession(userId: string, sessionId: string, body: CompleteSessionRequest): Promise<CompleteSessionResponse> {
  const session = await loadSession(userId, sessionId);
  if (session.status === 'completed' && session.review) {
    return { sessionId, alreadyCompleted: true, ...session.review };
  }
  if (session.status !== 'in_progress') {
    throw new HttpError(409, 'session_not_active', 'Ten trening został już zamknięty.');
  }

  const rows = await loadSessionExercises(userId, sessionId);
  const known = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  for (const s of body.sets) {
    if (!known.has(s.sessionExerciseId)) throw new HttpError(400, 'invalid_set_reference', 'Seria nie należy do tego treningu.');
    const key = `${s.sessionExerciseId}:${s.setIndex}`;
    if (seen.has(key)) throw new HttpError(400, 'duplicate_set', 'Ta sama seria została wysłana dwa razy.');
    seen.add(key);
  }

  const swaps = new Map((body.swaps ?? []).map((s) => [s.sessionExerciseId, s.exerciseId] as const));
  const skippedIds = new Set(body.skippedSessionExerciseIds ?? []);
  const finalRows = rows.map((r) => ({
    ...r,
    exercise_id: swaps.get(r.id) ?? r.exercise_id,
    skipped: r.skipped || skippedIds.has(r.id),
  }));

  const now = new Date();
  const requested = body.completedAt ? new Date(body.completedAt) : now;
  const completedAt = (requested.getTime() > now.getTime() ? now : requested).toISOString();
  const exerciseIds = unique(finalRows.map((r) => r.exercise_id));

  const [meta, prescriptions, variants, latestTargets, history, bests, readiness, level, entitlements, cycle] = await Promise.all([
    loadExercises(exerciseIds),
    loadPrescriptions(unique(finalRows.flatMap((r) => (r.program_exercise_id ? [r.program_exercise_id] : [])))),
    loadProgressionVariants(exerciseIds),
    loadLatestTargets(userId, exerciseIds),
    loadHistory(userId, exerciseIds, sessionId),
    loadPreviousBests(userId, exerciseIds),
    loadReadiness(userId, now),
    loadLevel(userId),
    getEntitlements(userId),
    loadSessionWeek(session),
  ]);
  const holdProgression = cycle?.week.holdProgression ?? false;
  const advanced = hasFeature(entitlements, 'progression_advanced');

  const recommendations: Array<{ rec: Recommendation; name: string; loadType: LoadType }> = [];
  const records: Array<{ exerciseId: string; name: string; record: PersonalRecord }> = [];
  const scored: ScoredExercise[] = [];

  for (const row of finalRows) {
    const m = meta.get(row.exercise_id);
    if (!m) throw new HttpError(400, 'unknown_exercise', 'Nieznane ćwiczenie w treningu.');
    const programRow = row.program_exercise_id ? prescriptions.get(row.program_exercise_id) : undefined;
    const base = forWeek(toPrescription(row.exercise_id, m, programRow, variants.get(row.exercise_id)), programRow, cycle?.week ?? null);
    // FREE: podstawowa double progression; PRO/PREMIUM: model z recepty (RIR, RPE, objętość).
    const prescription: Prescription = advanced ? base : { ...base, model: 'double_progression' };

    const sets: LoggedSet[] = body.sets
      .filter((s) => s.sessionExerciseId === row.id && (s.setType ?? 'working') === 'working')
      .sort((a, b) => a.setIndex - b.setIndex)
      .map((s) => ({ loadKg: s.loadKg, reps: s.reps, rir: s.rir ?? null, rpe: s.rpe ?? null, completed: s.completed }));

    scored.push({ prescription, target: latestTargets.get(row.exercise_id)?.next ?? null, sets, skipped: row.skipped });
    if (row.skipped || !sets.some((s) => s.completed)) continue;

    // Tydzień odciążenia nie zmienia celów progresji — rekordy liczą się normalnie.
    if (!holdProgression) {
      const exposure: ExerciseExposure = { sessionId, performedAt: completedAt, sets };
      const rec = recommendNext(prescription, [...(history.get(row.exercise_id) ?? []), exposure], { level, readiness });
      recommendations.push({ rec, name: m.name_pl, loadType: m.load_type });
    }
    for (const record of detectRecords(prescription.loadType, sets, bests.get(row.exercise_id) ?? {})) {
      records.push({ exerciseId: row.exercise_id, name: m.name_pl, record });
    }
  }

  const score = scoreSession(scored, countNewRecords(records.map((r) => r.record)));
  const reviewRecords: ReviewRecord[] = records
    .filter((r) => !r.record.isFirst)
    .map((r) => ({ exerciseId: r.exerciseId, exerciseName: r.name, kind: r.record.kind, value: r.record.value, improvement: r.record.improvement }));
  const nextTargets: ReviewTarget[] = recommendations.map(({ rec, name, loadType }) => ({
    exerciseId: rec.exerciseId,
    exerciseName: name,
    loadType,
    action: rec.action,
    confidence: rec.confidence,
    next: rec.next,
    explanation: rec.explanation,
  }));

  const review = await generateSessionReview(
    aiGateway(),
    {
      score: score.score,
      records: reviewRecords.map((r) => ({ exerciseName: r.exerciseName, kind: r.kind, value: r.value, improvement: r.improvement })),
      nextTargets: nextTargets.map((t) => ({
        exerciseName: t.exerciseName,
        action: t.action,
        loadKg: t.next.loadKg,
        repMin: t.next.repMin,
        repMax: t.next.repMax,
        sets: t.next.sets,
        explanation: t.explanation,
      })),
    },
    { allowAi: hasFeature(entitlements, 'ai_session_review'), userId },
  );

  const stored: StoredReview = { score: score.score, review, records: reviewRecords, nextTargets };
  const { error } = await db().rpc('complete_workout_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_sets: body.sets.map((s) => ({
      sessionExerciseId: s.sessionExerciseId,
      setIndex: s.setIndex,
      setType: s.setType ?? 'working',
      loadKg: s.loadKg,
      reps: s.reps,
      rir: s.rir ?? null,
      rpe: s.rpe ?? null,
      completed: s.completed,
    })),
    p_score: score.score,
    p_review: stored,
    p_recommendations: recommendations.map(({ rec }) => rec),
    p_records: records.map(({ exerciseId, record }) => ({ exerciseId, kind: record.kind, value: record.value, previous: record.previous })),
    p_skipped: finalRows.filter((r) => r.skipped).map((r) => r.id),
    p_swaps: body.swaps ?? [],
    p_session_rpe: body.sessionRpe ?? null,
    p_completed_at: completedAt,
  });
  if (error) throw mapRpcError(error);

  return { sessionId, alreadyCompleted: false, ...stored };
}
