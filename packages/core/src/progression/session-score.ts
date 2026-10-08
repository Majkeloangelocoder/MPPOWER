import { dominantLoad, effectiveRir, mean, round2 } from './math.ts';
import type { LoggedSet, NextTarget, Prescription } from './types.ts';

export interface ScoredExercise {
  prescription: Prescription;
  /** Cel pokazany przed sesją (z ostatniej rekomendacji); brak → dół zakresu. */
  target?: NextTarget | null;
  sets: readonly LoggedSet[];
  skipped?: boolean;
}

export interface SessionScore {
  /** 1–10, np. „9/10” w AI Review */
  score: number;
  completion: number;
  performance: number;
  /** Trafność RIR (±1 od celu); null, gdy użytkownik nie zapisywał RIR. */
  effort: number | null;
}

/**
 * Ocena sesji z reguł (bez AI): realizacja serii 45%, wykonanie celów 40%,
 * trafność wysiłku 15% (gdy brak RIR — wagi przeliczone proporcjonalnie), +0,5 pkt za rekord (maks. +1).
 */
export function scoreSession(exercises: readonly ScoredExercise[], newRecords = 0): SessionScore {
  let planned = 0;
  let done = 0;
  const perf: number[] = [];
  let effortHits = 0;
  let effortLogged = 0;

  for (const ex of exercises) {
    const p = ex.prescription;
    const plannedSets = ex.target?.sets ?? p.sets;
    planned += plannedSets;
    const completedSets = ex.sets.filter((s) => s.completed);
    done += Math.min(completedSets.length, plannedSets);
    if (ex.skipped) {
      perf.push(0);
      continue;
    }

    const targets = ex.target?.repsPerSet ?? [];
    let required = 0;
    let achieved = 0;
    for (let i = 0; i < plannedSets; i++) {
      const t = targets[i] ?? p.repMin;
      required += t;
      const s = completedSets[i];
      if (s) achieved += Math.min(s.reps, t);
    }
    let ratio = required > 0 ? achieved / required : 1;
    const targetLoad = ex.target?.loadKg ?? null;
    const load = dominantLoad(completedSets);
    if (targetLoad !== null && targetLoad > 0 && load !== null && load < targetLoad) ratio *= load / targetLoad;
    perf.push(ratio);

    for (const s of completedSets) {
      const r = effectiveRir(s);
      if (r === null) continue;
      effortLogged += 1;
      if (Math.abs(r - p.targetRir) <= 1) effortHits += 1;
    }
  }

  const completion = planned > 0 ? done / planned : 0;
  const performance = perf.length > 0 ? mean(perf) : 0;
  const effort = effortLogged > 0 ? effortHits / effortLogged : null;
  const base =
    effort === null
      ? 10 * ((0.45 / 0.85) * completion + (0.4 / 0.85) * performance)
      : 10 * (0.45 * completion + 0.4 * performance + 0.15 * effort);
  const bonus = Math.min(1, 0.5 * Math.max(0, newRecords));
  return {
    score: Math.max(1, Math.min(10, Math.round(base + bonus))),
    completion: round2(completion),
    performance: round2(performance),
    effort: effort === null ? null : round2(effort),
  };
}
