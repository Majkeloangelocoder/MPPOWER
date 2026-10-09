import {
  applyWeek,
  countNewRecords,
  currentCycleWeek,
  detectRecords,
  fitTargetToSets,
  generateCyclePlan,
  profileCompleteness,
  ProfileIncompleteError,
  recommendNext,
  scoreSession,
  STARTER_LIBRARY,
  type CompleteSessionRequest,
  type CompleteSessionResponse,
  type EntitlementsResponse,
  type ExerciseExposure,
  type GeneratedProgram,
  type GeneratePlanResponse,
  type HomeCycle,
  type HomeResponse,
  type LibraryExercise,
  type LoggedSet,
  type NextTarget,
  type OnboardingProfile,
  type PersonalRecord,
  type PhotoPose,
  type PlannedExercise,
  type PlayerPayload,
  type Prescription,
  type PreviousBests,
  type ProfileResponse,
  type ProgressPhoto,
  type ReviewRecord,
  type ReviewTarget,
  type ScoredExercise,
  type StartSessionRequest,
  type UpdateProfileRequest,
  type WeekPlan,
} from '@mp-power/core';
import { buildRuleBasedReview } from '@mp-power/ai';
import { readState, writeState } from './store';

/**
 * Serwer demo działający w przeglądarce: te same kroki co apps/web (profil → generator planu →
 * tydzień cyklu → silnik progresji → rekordy → ocena → podsumowanie z reguł). Dane startowe z seed.sql.
 */

const LIBRARY = new Map<string, LibraryExercise>(STARTER_LIBRARY.map((e) => [e.id, e]));

/** Krok obciążenia jak w seed.sql (sztanga 2,5 kg, hantle 2 kg, maszyny 5 kg). */
function incrementFor(e: LibraryExercise): number {
  if (e.loadType !== 'external') return 0;
  if (e.equipment.includes('machine')) return 5;
  if (e.equipment.includes('barbell') || e.equipment.includes('cable')) return 2.5;
  return e.equipment.includes('dumbbells') && e.primaryMuscles.some((m) => m === 'biceps' || m === 'triceps') ? 1 : 2;
}

export interface ProgramDay { id: string; day_index: number; title: string; focus: string; estimated_minutes: number }

const E = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GENERAL_ID = 'b0000000-0000-4000-8000-000000000001';
const GENERAL_TITLE = 'MP POWER Start — Full Body A/B';
export const PROGRAM_DAYS: ProgramDay[] = [
  { id: 'd0000000-0000-4000-8000-000000000001', day_index: 1, title: 'Full Body A', focus: 'przysiad, wyciskanie, wiosłowanie', estimated_minutes: 50 },
  { id: 'd0000000-0000-4000-8000-000000000002', day_index: 2, title: 'Full Body B', focus: 'zawias biodrowy, pompki, przyciąganie', estimated_minutes: 50 },
];

const pe = (n: number, block: PlannedExercise['block'], sets: number, repMin: number, repMax: number, tempo: string | null, restSeconds: number): PlannedExercise => ({
  exerciseId: E(n), name: LIBRARY.get(E(n))!.name, loadType: LIBRARY.get(E(n))!.loadType, block, sets, repMin, repMax, targetRir: 2, tempo, restSeconds, model: 'double_progression',
});
const GENERAL: Record<string, PlannedExercise[]> = {
  [PROGRAM_DAYS[0]!.id]: [pe(2, 'main', 3, 8, 12, '3-1-1-0', 120), pe(8, 'main', 3, 8, 12, '2-1-1-0', 120), pe(16, 'main', 3, 8, 12, '2-0-1-1', 90), pe(6, 'accessory', 3, 10, 15, '2-1-1-1', 60), pe(19, 'finisher', 3, 20, 40, null, 60)],
  [PROGRAM_DAYS[1]!.id]: [pe(4, 'main', 3, 8, 12, '3-1-1-0', 120), pe(10, 'main', 3, 6, 12, '2-1-1-0', 90), pe(14, 'main', 3, 8, 12, '2-0-1-1', 90), pe(18, 'accessory', 2, 8, 12, null, 90), pe(20, 'finisher', 3, 8, 12, null, 60)],
};

interface PersonalProgram { id: string; program: GeneratedProgram; startedAt: string; active: boolean }
interface Session { id: string; programDayId: string; clientSessionId: string; startedAt: string; cycleWeek: number | null; result: CompleteSessionResponse | null }
interface State {
  sessions: Session[];
  history: Record<string, ExerciseExposure[]>;
  bests: Record<string, PreviousBests>;
  targets: Record<string, { next: NextTarget; explanation: string }>;
  profile: OnboardingProfile;
  consents: { healthData: boolean; bodyImages: boolean };
  programs: PersonalProgram[];
}

const empty = (): State => ({ sessions: [], history: {}, bests: {}, targets: {}, profile: {}, consents: { healthData: false, bodyImages: false }, programs: [] });
let state: State = { ...empty(), ...readState<Partial<State>>('state', {}) };
// Zdjęcia osobno: duże, więc ich zapis może się nie zmieścić w magazynie przeglądarki — reszta stanu zostaje.
let photos: ProgressPhoto[] = readState<ProgressPhoto[]>('photos', []);
const save = () => writeState('state', state);

export class DemoHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const activeProgram = () => state.programs.find((p) => p.active) ?? null;
const dayId = (programId: string, dayIndex: number) => `${programId}-d${dayIndex}`;

/** Dzień programu (ogólnego albo spersonalizowanego) z receptami i programem, do którego należy. */
function findDay(programDayId: string): { title: string; exercises: PlannedExercise[]; personal: PersonalProgram | null } | null {
  const general = PROGRAM_DAYS.find((d) => d.id === programDayId);
  if (general) return { title: general.title, exercises: GENERAL[general.id]!, personal: null };
  for (const p of state.programs) {
    const day = p.program.days.find((d) => dayId(p.id, d.dayIndex) === programDayId);
    if (day) return { title: day.title, exercises: day.exercises, personal: p };
  }
  return null;
}

const toCycle = (week: WeekPlan, total: number): HomeCycle => ({ week: week.weekIndex, totalWeeks: total, phase: week.phase, label: week.label, focus: week.focus, checkIn: week.checkIn });

function sessionWeek(session: Session): { week: WeekPlan; total: number } | null {
  const day = findDay(session.programDayId);
  if (!day?.personal || session.cycleWeek === null) return null;
  const week = day.personal.program.weeks.find((w) => w.weekIndex === session.cycleWeek);
  return week ? { week, total: day.personal.program.cycleWeeks } : null;
}

function prescriptionFor(row: PlannedExercise, week: WeekPlan | null): Prescription {
  const ex = LIBRARY.get(row.exerciseId)!;
  const w = applyWeek(row, week);
  return {
    exerciseId: row.exerciseId,
    loadType: ex.loadType,
    loadIncrementKg: incrementFor(ex),
    progressionExerciseId: null,
    sets: w.sets,
    repMin: row.repMin,
    repMax: row.repMax,
    targetRir: w.targetRir,
    model: row.model,
  };
}

function payload(session: Session): PlayerPayload {
  const day = findDay(session.programDayId)!;
  const cycle = sessionWeek(session);
  return {
    sessionId: session.id,
    title: day.title,
    startedAt: session.startedAt,
    cycle: cycle ? toCycle(cycle.week, cycle.total) : null,
    exercises: day.exercises.map((row, i) => {
      const ex = LIBRARY.get(row.exerciseId)!;
      const p = prescriptionFor(row, cycle?.week ?? null);
      const latest = state.targets[row.exerciseId];
      const target = latest && latest.next.exerciseId === row.exerciseId ? latest.next : null;
      return {
        sessionExerciseId: `${session.id}:${i}`,
        exerciseId: row.exerciseId,
        name: ex.name,
        loadType: ex.loadType,
        orderIndex: i + 1,
        prescription: { sets: p.sets, repMin: p.repMin, repMax: p.repMax, targetRir: p.targetRir, restSeconds: row.restSeconds, tempo: row.tempo, model: row.model, notes: null },
        target: target && cycle ? fitTargetToSets(target, p.sets) : target,
        why: latest?.explanation ?? null,
      };
    }),
  };
}

function startSession(body: StartSessionRequest): PlayerPayload {
  const day = findDay(body.programDayId);
  if (!day) throw new DemoHttpError(404, 'not_found', 'Nie znaleziono dnia programu.');
  let session = state.sessions.find((s) => s.clientSessionId === body.clientSessionId);
  if (!session) {
    const personal = day.personal?.active ? day.personal : null;
    session = {
      id: `demo-${Date.now().toString(36)}`,
      programDayId: body.programDayId,
      clientSessionId: body.clientSessionId,
      startedAt: new Date().toISOString(),
      cycleWeek: personal ? currentCycleWeek(personal.startedAt, new Date(), personal.program.cycleWeeks) : null,
      result: null,
    };
    state.sessions.push(session);
    save();
  }
  return payload(session);
}

function completeSession(sessionId: string, body: CompleteSessionRequest): CompleteSessionResponse {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new DemoHttpError(404, 'not_found', 'Nie znaleziono treningu.');
  if (session.result) return { ...session.result, alreadyCompleted: true };

  const day = findDay(session.programDayId)!;
  const cycle = sessionWeek(session);
  const skipped = new Set(body.skippedSessionExerciseIds ?? []);
  const completedAt = new Date().toISOString();
  const recommendations: ReviewTarget[] = [];
  const records: Array<{ exerciseId: string; name: string; record: PersonalRecord }> = [];
  const scored: ScoredExercise[] = [];

  day.exercises.forEach((row, i) => {
    const id = `${session.id}:${i}`;
    const ex = LIBRARY.get(row.exerciseId)!;
    const prescription = prescriptionFor(row, cycle?.week ?? null);
    const sets: LoggedSet[] = body.sets
      .filter((s) => s.sessionExerciseId === id && (s.setType ?? 'working') === 'working')
      .sort((a, b) => a.setIndex - b.setIndex)
      .map((s) => ({ loadKg: s.loadKg, reps: s.reps, rir: s.rir ?? null, rpe: s.rpe ?? null, completed: s.completed }));
    const isSkipped = skipped.has(id);
    scored.push({ prescription, target: state.targets[row.exerciseId]?.next ?? null, sets, skipped: isSkipped });
    if (isSkipped || !sets.some((s) => s.completed)) return;

    const history = [...(state.history[row.exerciseId] ?? []), { sessionId, performedAt: completedAt, sets }].slice(-6);
    state.history[row.exerciseId] = history;
    // Tydzień odciążenia nie zmienia celów progresji.
    if (!cycle?.week.holdProgression) {
      const rec = recommendNext(prescription, history, { level: state.profile.level ?? 'beginner' });
      state.targets[row.exerciseId] = { next: rec.next, explanation: rec.explanation };
      recommendations.push({ exerciseId: rec.exerciseId, exerciseName: ex.name, loadType: ex.loadType, action: rec.action, confidence: rec.confidence, next: rec.next, explanation: rec.explanation });
    }

    const bests = state.bests[row.exerciseId] ?? {};
    for (const record of detectRecords(ex.loadType, sets, bests)) {
      records.push({ exerciseId: row.exerciseId, name: ex.name, record });
      bests[record.kind] = record.value;
    }
    state.bests[row.exerciseId] = bests;
  });

  const score = scoreSession(scored, countNewRecords(records.map((r) => r.record)));
  const reviewRecords: ReviewRecord[] = records
    .filter((r) => !r.record.isFirst)
    .map((r) => ({ exerciseId: r.exerciseId, exerciseName: r.name, kind: r.record.kind, value: r.record.value, improvement: r.record.improvement }));
  const review = buildRuleBasedReview({
    score: score.score,
    records: reviewRecords.map((r) => ({ exerciseName: r.exerciseName, kind: r.kind, value: r.value, improvement: r.improvement })),
    nextTargets: recommendations.map((t) => ({
      exerciseName: t.exerciseName, action: t.action, loadKg: t.next.loadKg, repMin: t.next.repMin, repMax: t.next.repMax, sets: t.next.sets, explanation: t.explanation,
    })),
  });

  session.result = { sessionId, alreadyCompleted: false, score: score.score, review, records: reviewRecords, nextTargets: recommendations };
  save();
  return session.result;
}

// ---------------------------------------------------------------------------
// Profil, ekran główny, plan na cykl
// ---------------------------------------------------------------------------

function profileResponse(): ProfileResponse {
  return { profile: state.profile, completeness: profileCompleteness(state.profile), consents: state.consents, photos };
}

function updateProfile(req: UpdateProfileRequest): ProfileResponse {
  const { consents, circumferences, ...fields } = req;
  if (consents?.healthData !== undefined) state.consents.healthData = consents.healthData;
  if (consents?.bodyImages !== undefined) state.consents.bodyImages = consents.bodyImages;
  if (fields.limitations && fields.limitations.length > 0 && !state.consents.healthData) {
    throw new DemoHttpError(403, 'consent_required', 'Aby uwzględnić kontuzje, potrzebujemy zgody na przetwarzanie danych o zdrowiu.');
  }
  const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  state.profile = { ...state.profile, ...defined, circumferences: { ...state.profile.circumferences, ...circumferences } };
  save();
  return profileResponse();
}

function home(): HomeResponse {
  const completeness = profileCompleteness(state.profile);
  const active = activeProgram();
  if (active) {
    const week = active.program.weeks.find((w) => w.weekIndex === currentCycleWeek(active.startedAt, new Date(), active.program.cycleWeeks));
    return {
      completeness,
      program: {
        id: active.id,
        title: active.program.title,
        kind: 'personal',
        cycle: week ? toCycle(week, active.program.cycleWeeks) : null,
        insights: active.program.insights,
        days: active.program.days.map((d) => ({ id: dayId(active.id, d.dayIndex), dayIndex: d.dayIndex, title: d.title, focus: d.focus, estimatedMinutes: d.estimatedMinutes })),
      },
    };
  }
  return {
    completeness,
    program: {
      id: GENERAL_ID,
      title: GENERAL_TITLE,
      kind: 'general',
      cycle: null,
      insights: [],
      days: PROGRAM_DAYS.map((d) => ({ id: d.id, dayIndex: d.day_index, title: d.title, focus: d.focus, estimatedMinutes: d.estimated_minutes })),
    },
  };
}

function generate(): GeneratePlanResponse {
  let plan;
  try {
    plan = generateCyclePlan(state.profile, STARTER_LIBRARY);
  } catch (err) {
    if (err instanceof ProfileIncompleteError) throw new DemoHttpError(409, 'profile_incomplete', err.message);
    throw err;
  }
  for (const p of state.programs) p.active = false;
  const id = `p${state.programs.length + 1}`;
  state.programs.push({ id, program: plan.program, startedAt: new Date().toISOString(), active: true });
  save();
  return { programId: id, program: plan.program, nutrition: plan.nutrition };
}

/** Zdjęcie z demo: adres pliku z przeglądarki (zostaje na tym urządzeniu). */
export function addPhoto(pose: PhotoPose, url: string): void {
  if (!state.consents.bodyImages) throw new DemoHttpError(403, 'consent_required', 'Zaznacz zgodę na przechowywanie zdjęć.');
  photos = [{ id: `photo-${Date.now().toString(36)}`, pose, takenAt: new Date().toISOString(), url }, ...photos];
  writeState('photos', photos);
}

const ENTITLEMENTS: EntitlementsResponse = { planCode: 'demo', validUntil: null, inGracePeriod: false, features: {} };

/** Router odpowiadający ścieżkom /api/v1 z apps/web. */
export function handle(method: string, path: string, body: unknown): unknown {
  if (method === 'GET' && path === '/api/v1/me/entitlements') return ENTITLEMENTS;
  if (method === 'GET' && path === '/api/v1/me/home') return home();
  if (method === 'GET' && path === '/api/v1/me/profile') return profileResponse();
  if (method === 'PUT' && path === '/api/v1/me/profile') return updateProfile(body as UpdateProfileRequest);
  if (method === 'POST' && path === '/api/v1/programs/generate') return generate();
  if (method === 'POST' && path === '/api/v1/sessions') return startSession(body as StartSessionRequest);
  const complete = /^\/api\/v1\/sessions\/([^/]+)\/complete$/.exec(path);
  if (method === 'POST' && complete) return completeSession(decodeURIComponent(complete[1]!), body as CompleteSessionRequest);
  const get = /^\/api\/v1\/sessions\/([^/]+)$/.exec(path);
  if (method === 'GET' && get) {
    const session = state.sessions.find((s) => s.id === decodeURIComponent(get[1]!));
    if (!session) throw new DemoHttpError(404, 'not_found', 'Nie znaleziono treningu.');
    return payload(session);
  }
  throw new DemoHttpError(404, 'not_found', 'Nie znaleziono danych na serwerze.');
}

export function resetDemo(): void {
  state = empty();
  photos = [];
  save();
  writeState('photos', photos);
}
