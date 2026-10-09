import {
  countNewRecords,
  detectRecords,
  recommendNext,
  scoreSession,
  type CompleteSessionRequest,
  type CompleteSessionResponse,
  type EntitlementsResponse,
  type ExerciseExposure,
  type LoadType,
  type LoggedSet,
  type NextTarget,
  type PersonalRecord,
  type PlayerPayload,
  type Prescription,
  type PreviousBests,
  type ProgressionModel,
  type ReviewRecord,
  type ReviewTarget,
  type ScoredExercise,
  type StartSessionRequest,
} from '@mp-power/core';
import { buildRuleBasedReview } from '@mp-power/ai';
import { readState, writeState } from './store';

/**
 * Serwer demo działający w przeglądarce: te same kroki co apps/web/lib/workouts.ts
 * (silnik progresji → rekordy → ocena → podsumowanie z reguł), dane z supabase/seed.sql.
 */

interface Exercise { name: string; loadType: LoadType; incrementKg: number }
interface ProgramExercise { exerciseId: string; sets: number; repMin: number; repMax: number; targetRir: number; tempo: string | null; restSeconds: number; model: ProgressionModel }
export interface ProgramDay { id: string; day_index: number; title: string; focus: string; estimated_minutes: number }

const E = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EXERCISES: Record<string, Exercise> = {
  [E(2)]: { name: 'Przysiad goblet', loadType: 'external', incrementKg: 2 },
  [E(4)]: { name: 'Martwy ciąg rumuński z hantlami', loadType: 'external', incrementKg: 2 },
  [E(6)]: { name: 'Most biodrowy', loadType: 'bodyweight', incrementKg: 0 },
  [E(8)]: { name: 'Wyciskanie hantli leżąc', loadType: 'external', incrementKg: 2 },
  [E(10)]: { name: 'Pompki', loadType: 'bodyweight', incrementKg: 0 },
  [E(14)]: { name: 'Ściąganie drążka wyciągu górnego', loadType: 'external', incrementKg: 2.5 },
  [E(16)]: { name: 'Wiosłowanie hantlem jednorącz', loadType: 'external', incrementKg: 2 },
  [E(18)]: { name: 'Wykroki chodzone z hantlami', loadType: 'external', incrementKg: 2 },
  [E(19)]: { name: 'Deska (plank)', loadType: 'time', incrementKg: 0 },
  [E(20)]: { name: 'Dead bug', loadType: 'bodyweight', incrementKg: 0 },
};

export const PROGRAM_DAYS: ProgramDay[] = [
  { id: 'd0000000-0000-4000-8000-000000000001', day_index: 1, title: 'Full Body A', focus: 'przysiad, wyciskanie, wiosłowanie', estimated_minutes: 50 },
  { id: 'd0000000-0000-4000-8000-000000000002', day_index: 2, title: 'Full Body B', focus: 'zawias biodrowy, pompki, przyciąganie', estimated_minutes: 50 },
];

const pe = (n: number, sets: number, repMin: number, repMax: number, tempo: string | null, restSeconds: number): ProgramExercise => ({
  exerciseId: E(n), sets, repMin, repMax, targetRir: 2, tempo, restSeconds, model: 'double_progression',
});
const PROGRAM: Record<string, ProgramExercise[]> = {
  [PROGRAM_DAYS[0]!.id]: [pe(2, 3, 8, 12, '3-1-1-0', 120), pe(8, 3, 8, 12, '2-1-1-0', 120), pe(16, 3, 8, 12, '2-0-1-1', 90), pe(6, 3, 10, 15, '2-1-1-1', 60), pe(19, 3, 20, 40, null, 60)],
  [PROGRAM_DAYS[1]!.id]: [pe(4, 3, 8, 12, '3-1-1-0', 120), pe(10, 3, 6, 12, '2-1-1-0', 90), pe(14, 3, 8, 12, '2-0-1-1', 90), pe(18, 2, 8, 12, null, 90), pe(20, 3, 8, 12, null, 60)],
};

interface Session { id: string; programDayId: string; clientSessionId: string; startedAt: string; result: CompleteSessionResponse | null }
interface State {
  sessions: Session[];
  history: Record<string, ExerciseExposure[]>;
  bests: Record<string, PreviousBests>;
  targets: Record<string, { next: NextTarget; explanation: string }>;
}

let state: State = readState<State>('state', { sessions: [], history: {}, bests: {}, targets: {} });
const save = () => writeState('state', state);

export class DemoHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const sessionExerciseId = (sessionId: string, i: number) => `${sessionId}:${i}`;

function prescriptionFor(row: ProgramExercise): Prescription {
  const ex = EXERCISES[row.exerciseId]!;
  return {
    exerciseId: row.exerciseId,
    loadType: ex.loadType,
    loadIncrementKg: ex.loadType === 'external' ? ex.incrementKg : 0,
    progressionExerciseId: null,
    sets: row.sets,
    repMin: row.repMin,
    repMax: row.repMax,
    targetRir: row.targetRir,
    model: row.model,
  };
}

function payload(session: Session): PlayerPayload {
  const day = PROGRAM_DAYS.find((d) => d.id === session.programDayId)!;
  return {
    sessionId: session.id,
    title: day.title,
    startedAt: session.startedAt,
    exercises: PROGRAM[day.id]!.map((row, i) => {
      const ex = EXERCISES[row.exerciseId]!;
      const latest = state.targets[row.exerciseId];
      return {
        sessionExerciseId: sessionExerciseId(session.id, i),
        exerciseId: row.exerciseId,
        name: ex.name,
        loadType: ex.loadType,
        orderIndex: i + 1,
        prescription: { sets: row.sets, repMin: row.repMin, repMax: row.repMax, targetRir: row.targetRir, restSeconds: row.restSeconds, tempo: row.tempo, model: row.model, notes: null },
        target: latest && latest.next.exerciseId === row.exerciseId ? latest.next : null,
        why: latest?.explanation ?? null,
      };
    }),
  };
}

function startSession(body: StartSessionRequest): PlayerPayload {
  if (!PROGRAM[body.programDayId]) throw new DemoHttpError(404, 'not_found', 'Nie znaleziono dnia programu.');
  let session = state.sessions.find((s) => s.clientSessionId === body.clientSessionId);
  if (!session) {
    session = { id: `demo-${Date.now().toString(36)}`, programDayId: body.programDayId, clientSessionId: body.clientSessionId, startedAt: new Date().toISOString(), result: null };
    state.sessions.push(session);
    save();
  }
  return payload(session);
}

function completeSession(sessionId: string, body: CompleteSessionRequest): CompleteSessionResponse {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new DemoHttpError(404, 'not_found', 'Nie znaleziono treningu.');
  if (session.result) return { ...session.result, alreadyCompleted: true };

  const skipped = new Set(body.skippedSessionExerciseIds ?? []);
  const completedAt = new Date().toISOString();
  const recommendations: ReviewTarget[] = [];
  const records: Array<{ exerciseId: string; name: string; record: PersonalRecord }> = [];
  const scored: ScoredExercise[] = [];

  PROGRAM[session.programDayId]!.forEach((row, i) => {
    const id = sessionExerciseId(session.id, i);
    const ex = EXERCISES[row.exerciseId]!;
    const prescription = prescriptionFor(row);
    const sets: LoggedSet[] = body.sets
      .filter((s) => s.sessionExerciseId === id && (s.setType ?? 'working') === 'working')
      .sort((a, b) => a.setIndex - b.setIndex)
      .map((s) => ({ loadKg: s.loadKg, reps: s.reps, rir: s.rir ?? null, rpe: s.rpe ?? null, completed: s.completed }));
    const isSkipped = skipped.has(id);
    scored.push({ prescription, target: state.targets[row.exerciseId]?.next ?? null, sets, skipped: isSkipped });
    if (isSkipped || !sets.some((s) => s.completed)) return;

    const history = [...(state.history[row.exerciseId] ?? []), { sessionId, performedAt: completedAt, sets }].slice(-6);
    const rec = recommendNext(prescription, history, { level: 'beginner' });
    state.history[row.exerciseId] = history;
    state.targets[row.exerciseId] = { next: rec.next, explanation: rec.explanation };
    recommendations.push({ exerciseId: rec.exerciseId, exerciseName: ex.name, loadType: ex.loadType, action: rec.action, confidence: rec.confidence, next: rec.next, explanation: rec.explanation });

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

const ENTITLEMENTS: EntitlementsResponse = { planCode: 'demo', validUntil: null, inGracePeriod: false, features: {} };

/** Router odpowiadający ścieżkom /api/v1 z apps/web. */
export function handle(method: string, path: string, body: unknown): unknown {
  if (method === 'GET' && path === '/api/v1/me/entitlements') return ENTITLEMENTS;
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
  state = { sessions: [], history: {}, bests: {}, targets: {} };
  save();
}
