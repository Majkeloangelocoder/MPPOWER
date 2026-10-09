import type { ExperienceLevel, NextTarget } from '../progression/types.ts';
import type { PlannedExercise, TrainingGoal, WeekPlan } from './types.ts';

export const CYCLE_WEEKS = 8;

/**
 * Periodyzacja 8 tygodni: wprowadzenie → budowanie → odciążenie → budowanie II → szczyt → odciążenie.
 * Pomiary kontrolne w tygodniu 4 i 8 (porównanie z danymi startowymi).
 */
export function buildCycleWeeks(goal: TrainingGoal, level: ExperienceLevel): WeekPlan[] {
  const volumeGoal = goal === 'muscle_gain' || goal === 'fat_loss';
  const build2Sets = volumeGoal && level !== 'beginner' ? 1 : 0;
  const peakRir = level === 'beginner' ? 0 : -1;
  const week = (weekIndex: number, w: Omit<WeekPlan, 'weekIndex'>): WeekPlan => ({ weekIndex, ...w });
  return [
    week(1, { phase: 'intro', label: 'Wprowadzenie', setsDelta: -1, setsMultiplier: 1, rirDelta: 1, holdProgression: false, checkIn: false,
      focus: 'Poznaj ćwiczenia i dobierz ciężary z zapasem. Technika przed obciążeniem.' }),
    week(2, { phase: 'build', label: 'Budowanie', setsDelta: 0, setsMultiplier: 1, rirDelta: 0, holdProgression: false, checkIn: false,
      focus: 'Pełna objętość. Dokładaj powtórzenia, potem ciężar.' }),
    week(3, { phase: 'build', label: 'Budowanie', setsDelta: 0, setsMultiplier: 1, rirDelta: 0, holdProgression: false, checkIn: false,
      focus: 'Ten sam plan, lepsze wyniki niż tydzień temu.' }),
    week(4, { phase: 'deload', label: 'Odciążenie', setsDelta: 0, setsMultiplier: 0.6, rirDelta: 2, holdProgression: true, checkIn: true,
      focus: 'Mniej serii, więcej zapasu — ciało nadrabia regenerację. Zrób pomiary kontrolne.' }),
    week(5, { phase: 'build', label: 'Budowanie II', setsDelta: build2Sets, setsMultiplier: 1, rirDelta: 0, holdProgression: false, checkIn: false,
      focus: build2Sets ? 'Dodatkowa seria w głównych ćwiczeniach.' : 'Wracasz do pełnej objętości z wyższego poziomu.' }),
    week(6, { phase: 'build', label: 'Budowanie II', setsDelta: build2Sets, setsMultiplier: 1, rirDelta: 0, holdProgression: false, checkIn: false,
      focus: 'Utrzymaj tempo progresji.' }),
    week(7, { phase: 'peak', label: 'Szczyt', setsDelta: build2Sets, setsMultiplier: 1, rirDelta: peakRir, holdProgression: false, checkIn: false,
      focus: 'Najtrudniejszy tydzień cyklu: bliżej granicy możliwości, z dobrą techniką.' }),
    week(8, { phase: 'deload', label: 'Odciążenie i podsumowanie', setsDelta: 0, setsMultiplier: 0.6, rirDelta: 2, holdProgression: true, checkIn: true,
      focus: 'Lżejszy tydzień, pomiary i zdjęcia kontrolne. Potem projektujemy kolejny cykl.' }),
  ];
}

/** Numer tygodnia cyklu (1…cycleWeeks) dla daty; po końcu cyklu zostaje ostatni tydzień. */
export function currentCycleWeek(startedAt: string | Date, now: string | Date = new Date(), cycleWeeks = CYCLE_WEEKS): number {
  const days = Math.floor((new Date(now).getTime() - new Date(startedAt).getTime()) / 86_400_000);
  return Math.min(cycleWeeks, Math.max(1, Math.floor(days / 7) + 1));
}

/** Recepta na dany tydzień: serie i zapas RIR według fazy cyklu. */
export function applyWeek<T extends Pick<PlannedExercise, 'sets' | 'targetRir' | 'block'>>(base: T, week: WeekPlan | null | undefined): T {
  if (!week) return base;
  const delta = base.block === 'main' ? week.setsDelta : Math.min(0, week.setsDelta);
  const sets = Math.min(10, Math.max(1, Math.round((base.sets + delta) * week.setsMultiplier)));
  // Zapas powyżej 4 powtórzeń przestaje być bodźcem treningowym — także w odciążeniu.
  const targetRir = Math.min(4, Math.max(0, base.targetRir + week.rirDelta));
  return { ...base, sets, targetRir };
}

/** Cel z poprzedniej rekomendacji dopasowany do liczby serii w tym tygodniu (np. mniej w odciążeniu). */
export function fitTargetToSets(target: NextTarget, sets: number): NextTarget {
  if (target.sets === sets && target.repsPerSet.length === sets) return target;
  const last = target.repsPerSet.at(-1) ?? target.repMin;
  const repsPerSet = Array.from({ length: sets }, (_, i) => target.repsPerSet[i] ?? last);
  return { ...target, sets, repsPerSet };
}
