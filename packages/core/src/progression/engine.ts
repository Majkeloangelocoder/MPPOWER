import { buildExplanation } from './explain.ts';
import {
  clamp,
  decreaseLoad,
  dominantLoad,
  effectiveRir,
  increaseLoad,
  isNumber,
  mean,
  round1,
  uniform,
} from './math.ts';
import type {
  Confidence,
  ExerciseExposure,
  LoggedSet,
  NextTarget,
  Prescription,
  ProgressionContext,
  Reason,
  Recommendation,
  RecommendationAction,
} from './types.ts';

export const ENGINE_VERSION = 'progression@1.0.0';

interface Draft {
  action: RecommendationAction;
  next: NextTarget;
  reasons: Reason[];
  confidence: Confidence;
}

/**
 * Główna funkcja silnika: na podstawie recepty i historii wykonań
 * zwraca rekomendację na następną sesję wraz z uzasadnieniem.
 *
 * @param history wykonania ćwiczenia od najstarszego do najnowszego; ostatni element = sesja właśnie ukończona.
 */
export function recommendNext(
  prescription: Prescription,
  history: readonly ExerciseExposure[],
  context: ProgressionContext = { level: 'intermediate' },
): Recommendation {
  validatePrescription(prescription);
  const last = history.at(-1);
  const previous = history.length > 1 ? history.at(-2) : undefined;

  let draft: Draft;
  if (!last || last.sets.filter((s) => s.completed).length === 0) {
    draft = calibrate(prescription);
  } else if (prescription.loadType !== 'external') {
    draft = repsOnly(prescription, last, context);
  } else if (prescription.model === 'rir' || prescription.model === 'rpe') {
    draft = effortBased(prescription, last, previous, context);
  } else if (prescription.model === 'volume') {
    draft = volumeBased(prescription, last, previous, context);
  } else {
    draft = doubleProgression(prescription, last, previous, context);
  }

  const previousLoadKg = last ? dominantLoad(completed(last.sets)) : null;
  return {
    exerciseId: prescription.exerciseId,
    model: prescription.model,
    ...draft,
    explanation: buildExplanation({ prescription, previousLoadKg, ...draft }),
    engineVersion: ENGINE_VERSION,
  };
}

export function validatePrescription(p: Prescription): void {
  const problems: string[] = [];
  if (!Number.isInteger(p.sets) || p.sets < 1 || p.sets > 12) problems.push('sets must be an integer 1–12');
  if (!Number.isInteger(p.repMin) || p.repMin < 1) problems.push('repMin must be a positive integer');
  if (!Number.isInteger(p.repMax) || p.repMax < p.repMin) problems.push('repMax must be an integer ≥ repMin');
  if (!isNumber(p.targetRir) || p.targetRir < 0 || p.targetRir > 5) problems.push('targetRir must be 0–5');
  if (!isNumber(p.loadIncrementKg) || p.loadIncrementKg < 0) problems.push('loadIncrementKg must be ≥ 0');
  if (p.loadType === 'external' && !(p.loadIncrementKg > 0)) problems.push('external load needs loadIncrementKg > 0');
  if (problems.length > 0) {
    throw new RangeError(`Invalid prescription for ${p.exerciseId}: ${problems.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Strategie
// ---------------------------------------------------------------------------

function calibrate(p: Prescription): Draft {
  return {
    action: 'calibrate',
    next: target(p, null, uniform(p.sets, p.repMin)),
    reasons: [{ code: 'NO_HISTORY' }],
    confidence: 'low',
  };
}

/**
 * Double progression: najpierw powtórzenia w zakresie, potem ciężar.
 * Ciężar rośnie dopiero, gdy WSZYSTKIE serie osiągną górę zakresu z zapasem ≥ docelowy RIR.
 */
function doubleProgression(
  p: Prescription,
  last: ExerciseExposure,
  previous: ExerciseExposure | undefined,
  ctx: ProgressionContext,
): Draft {
  const done = completed(last.sets);
  const load = dominantLoad(done);
  if (load === null) return calibrate(p);

  const reps = done.map((s) => s.reps);
  const rirs = loggedRirs(done);
  const minRir = rirs.length > 0 ? Math.min(...rirs) : null;
  const reasons: Reason[] = [];

  if (done.length < p.sets) {
    reasons.push({ code: 'INCOMPLETE_SETS', params: { done: done.length, planned: p.sets } });
    return { action: 'hold_load', next: target(p, load, nextRepTargets(p, reps)), reasons, confidence: 'medium' };
  }

  if (reps.every((r) => r >= p.repMax)) {
    reasons.push({ code: 'ALL_SETS_AT_TOP', params: { repMax: p.repMax } });
    if (minRir === null) reasons.push({ code: 'RIR_NOT_LOGGED' });
    const reserveOk = minRir === null || minRir >= p.targetRir;
    if (!reserveOk) {
      reasons.push({ code: 'RESERVE_LOW', params: { minRir: minRir ?? 0, targetRir: p.targetRir } });
      return { action: 'hold_load', next: target(p, load, uniform(p.sets, p.repMax)), reasons, confidence: 'high' };
    }
    if (minRir !== null) reasons.push({ code: 'RESERVE_OK', params: { minRir, targetRir: p.targetRir } });
    if (ctx.readiness === 'reduced') {
      reasons.push({ code: 'READINESS_REDUCED' });
      return { action: 'hold_load', next: target(p, load, uniform(p.sets, p.repMax)), reasons, confidence: 'medium' };
    }
    return {
      action: 'increase_load',
      next: target(p, increaseLoad(load, p.loadIncrementKg), uniform(p.sets, p.repMin)),
      reasons,
      confidence: minRir === null ? 'medium' : 'high',
    };
  }

  if (reps.some((r) => r < p.repMin)) {
    if (previous && completed(previous.sets).some((s) => s.reps < p.repMin)) {
      reasons.push({ code: 'REPS_BELOW_MIN_REPEATED', params: { repMin: p.repMin } });
      return {
        action: 'decrease_load',
        next: target(p, decreaseLoad(load, p.loadIncrementKg, 0.075), uniform(p.sets, p.repMin)),
        reasons,
        confidence: 'high',
      };
    }
    reasons.push({ code: 'REPS_BELOW_MIN', params: { repMin: p.repMin } });
    return { action: 'hold_load', next: target(p, load, nextRepTargets(p, reps)), reasons, confidence: 'medium' };
  }

  reasons.push({ code: 'REPS_BELOW_TOP', params: { repMax: p.repMax } });
  if (minRir === null) reasons.push({ code: 'RIR_NOT_LOGGED' });
  else if (minRir < p.targetRir) reasons.push({ code: 'RESERVE_LOW', params: { minRir, targetRir: p.targetRir } });
  return {
    action: 'hold_load',
    next: target(p, load, nextRepTargets(p, reps)),
    reasons,
    confidence: minRir === null ? 'medium' : 'high',
  };
}

/**
 * Progresja oparta o RIR/RPE (stała liczba powtórzeń, np. 5×5 @ RIR 2).
 * Odchylenie średniego RIR od celu skaluje zmianę ciężaru (~2,5% na 1 punkt RIR, max 5% w górę).
 */
function effortBased(
  p: Prescription,
  last: ExerciseExposure,
  previous: ExerciseExposure | undefined,
  ctx: ProgressionContext,
): Draft {
  const done = completed(last.sets);
  const load = dominantLoad(done);
  if (load === null) return calibrate(p);

  const missed = done.length < p.sets || done.some((s) => s.reps < p.repMin);
  if (missed) {
    const prevDone = previous ? completed(previous.sets) : [];
    const prevMissed = previous !== undefined && (prevDone.length < p.sets || prevDone.some((s) => s.reps < p.repMin));
    if (prevMissed) {
      return {
        action: 'decrease_load',
        next: target(p, decreaseLoad(load, p.loadIncrementKg, 0.05), uniform(p.sets, p.repMin)),
        reasons: [{ code: 'REPS_BELOW_MIN_REPEATED', params: { repMin: p.repMin } }],
        confidence: 'high',
      };
    }
    const code = done.length < p.sets ? 'INCOMPLETE_SETS' : 'REPS_BELOW_MIN';
    return {
      action: 'hold_load',
      next: target(p, load, uniform(p.sets, p.repMin)),
      reasons: [{ code, params: { repMin: p.repMin, done: done.length, planned: p.sets } }],
      confidence: 'medium',
    };
  }

  const rirs = loggedRirs(done);
  if (rirs.length === 0) {
    // Bez RIR nie da się sterować wysiłkiem — zachowujemy się jak double progression, z niską pewnością.
    const fallback = doubleProgression(p, last, previous, ctx);
    return { ...fallback, confidence: 'low' };
  }

  const avgRir = round1(mean(rirs));
  const delta = round1(avgRir - p.targetRir);
  const params = { avgRir, targetRir: p.targetRir };

  if (delta >= 0 && ctx.readiness === 'reduced') {
    return {
      action: 'hold_load',
      next: target(p, load, uniform(p.sets, p.repMin)),
      reasons: [{ code: delta >= 1 ? 'RIR_ABOVE_TARGET' : 'RIR_ON_TARGET', params }, { code: 'READINESS_REDUCED' }],
      confidence: 'medium',
    };
  }
  if (delta >= 1) {
    const pct = Math.min(0.05, 0.025 * delta);
    return {
      action: 'increase_load',
      next: target(p, increaseLoad(load, p.loadIncrementKg, pct), uniform(p.sets, p.repMin)),
      reasons: [{ code: 'RIR_ABOVE_TARGET', params }],
      confidence: 'high',
    };
  }
  if (delta >= 0) {
    if (ctx.level === 'advanced') {
      return {
        action: 'hold_load',
        next: target(p, load, uniform(p.sets, p.repMin)),
        reasons: [{ code: 'RIR_ON_TARGET', params }, { code: 'ADVANCED_HOLD' }],
        confidence: 'high',
      };
    }
    return {
      action: 'increase_load',
      next: target(p, increaseLoad(load, p.loadIncrementKg), uniform(p.sets, p.repMin)),
      reasons: [{ code: 'RIR_ON_TARGET', params }],
      confidence: 'high',
    };
  }
  if (delta >= -1) {
    return {
      action: 'hold_load',
      next: target(p, load, uniform(p.sets, p.repMin)),
      reasons: [{ code: 'RIR_BELOW_TARGET', params }],
      confidence: 'high',
    };
  }
  const pct = Math.min(0.075, 0.025 * Math.abs(delta));
  return {
    action: 'decrease_load',
    next: target(p, decreaseLoad(load, p.loadIncrementKg, pct), uniform(p.sets, p.repMin)),
    reasons: [{ code: 'RIR_FAR_BELOW_TARGET', params }],
    confidence: 'high',
  };
}

/** Progresja objętości: ten sam ciężar, +1 seria, dopóki wynik i regeneracja na to pozwalają. */
function volumeBased(
  p: Prescription,
  last: ExerciseExposure,
  previous: ExerciseExposure | undefined,
  ctx: ProgressionContext,
): Draft {
  const done = completed(last.sets);
  const load = dominantLoad(done);
  if (load === null) return calibrate(p);
  const maxSets = p.maxSets ?? p.sets + 2;
  const reps = done.map((s) => s.reps);

  if (done.length < p.sets || reps.some((r) => r < p.repMin)) {
    // Spadek wyników — reguły double progression decydują o ciężarze, bez dokładania serii.
    return doubleProgression(p, last, previous, ctx);
  }
  const rirs = loggedRirs(done);
  const minRir = rirs.length > 0 ? Math.min(...rirs) : null;
  if (minRir !== null && minRir < p.targetRir) {
    return {
      action: 'hold_load',
      next: target(p, load, nextRepTargets(p, reps), done.length),
      reasons: [{ code: 'REPS_BELOW_TOP', params: { repMax: p.repMax } }, { code: 'RESERVE_LOW', params: { minRir, targetRir: p.targetRir } }],
      confidence: 'high',
    };
  }
  if (ctx.readiness === 'reduced') {
    return {
      action: 'hold_load',
      next: target(p, load, nextRepTargets(p, reps), done.length),
      reasons: [{ code: 'READINESS_REDUCED' }],
      confidence: 'medium',
    };
  }
  if (done.length >= maxSets) {
    return {
      action: 'hold_load',
      next: target(p, load, uniform(done.length, p.repMin), done.length),
      reasons: [{ code: 'VOLUME_CAP', params: { maxSets } }],
      confidence: 'high',
    };
  }
  const sets = done.length + 1;
  const reasons: Reason[] = [{ code: 'VOLUME_STEP', params: { sets } }];
  if (minRir === null) reasons.push({ code: 'RIR_NOT_LOGGED' });
  return {
    action: 'add_set',
    next: target(p, load, uniform(sets, p.repMin), sets),
    reasons,
    confidence: minRir === null ? 'medium' : 'high',
  };
}

/** Ćwiczenia z masą ciała i na czas: powtórzenia/sekundy → trudniejszy wariant → dodatkowa seria. */
function repsOnly(p: Prescription, last: ExerciseExposure, ctx: ProgressionContext): Draft {
  const done = completed(last.sets);
  const reps = done.map((s) => s.reps);
  const step = p.loadType === 'time' ? 5 : 1;
  const rirs = loggedRirs(done);
  const minRir = rirs.length > 0 ? Math.min(...rirs) : null;

  if (done.length < p.sets) {
    return {
      action: 'increase_reps',
      next: target(p, null, nextRepTargets(p, reps, step)),
      reasons: [{ code: 'INCOMPLETE_SETS', params: { done: done.length, planned: p.sets } }],
      confidence: 'medium',
    };
  }

  const allAtTop = reps.every((r) => r >= p.repMax);
  if (!allAtTop) {
    if (ctx.readiness === 'reduced') {
      return {
        action: 'increase_reps',
        next: target(p, null, reps.slice(0, p.sets).map((r) => clamp(r, p.repMin, p.repMax))),
        reasons: [{ code: 'READINESS_REDUCED' }],
        confidence: 'medium',
      };
    }
    return {
      action: 'increase_reps',
      next: target(p, null, nextRepTargets(p, reps, step)),
      reasons: [{ code: 'REPS_BELOW_TOP', params: { repMax: p.repMax } }],
      confidence: minRir === null ? 'medium' : 'high',
    };
  }

  const reasons: Reason[] = [{ code: 'ALL_SETS_AT_TOP', params: { repMax: p.repMax } }];
  if (minRir !== null && minRir < p.targetRir) {
    reasons.push({ code: 'RESERVE_LOW', params: { minRir, targetRir: p.targetRir } });
    return { action: 'increase_reps', next: target(p, null, uniform(p.sets, p.repMax)), reasons, confidence: 'high' };
  }
  if (ctx.readiness === 'reduced') {
    reasons.push({ code: 'READINESS_REDUCED' });
    return { action: 'increase_reps', next: target(p, null, uniform(p.sets, p.repMax)), reasons, confidence: 'medium' };
  }
  if (p.progressionExerciseId) {
    reasons.push({ code: 'VARIANT_AVAILABLE' });
    return {
      action: 'progress_variant',
      next: target(p, null, uniform(p.sets, p.repMin), p.sets, p.progressionExerciseId),
      reasons,
      confidence: minRir === null ? 'medium' : 'high',
    };
  }
  const maxSets = p.maxSets ?? p.sets + 2;
  reasons.push({ code: 'VARIANT_MISSING' });
  if (done.length < maxSets) {
    const sets = done.length + 1;
    reasons.push({ code: 'VOLUME_STEP', params: { sets } });
    return {
      action: 'add_set',
      next: target(p, null, [...uniform(done.length, p.repMax), p.repMin], sets),
      reasons,
      confidence: 'medium',
    };
  }
  reasons.push({ code: 'VOLUME_CAP', params: { maxSets } });
  return { action: 'increase_reps', next: target(p, null, uniform(done.length, p.repMax), done.length), reasons, confidence: 'medium' };
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

function completed(sets: readonly LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => s.completed);
}

function loggedRirs(sets: readonly LoggedSet[]): number[] {
  const out: number[] = [];
  for (const s of sets) {
    const r = effectiveRir(s);
    if (r !== null) out.push(r);
  }
  return out;
}

/** Cel na każdą serię: +1 (lub +krok) względem ostatniego wyniku, w granicach zakresu. */
function nextRepTargets(p: Prescription, reps: readonly number[], step = 1): number[] {
  return Array.from({ length: p.sets }, (_, i) => {
    const r = reps[i];
    return r === undefined ? p.repMin : clamp(r + step, p.repMin, p.repMax);
  });
}

function target(
  p: Prescription,
  loadKg: number | null,
  repsPerSet: number[],
  sets = p.sets,
  exerciseId = p.exerciseId,
): NextTarget {
  return { exerciseId, loadKg, sets, repMin: p.repMin, repMax: p.repMax, repsPerSet, targetRir: p.targetRir };
}
