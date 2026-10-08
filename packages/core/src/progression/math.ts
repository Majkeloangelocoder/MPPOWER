import type { LoggedSet } from './types.ts';

const EPS = 1e-9;

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Zaokrąglenie do dostępnego kroku obciążenia (np. 2,5 kg talerzy). */
export function roundToIncrement(
  value: number,
  increment: number,
  mode: 'nearest' | 'down' | 'up' = 'nearest',
): number {
  if (!(increment > 0)) return round2(value);
  const q = value / increment;
  const n = mode === 'down' ? Math.floor(q + EPS) : mode === 'up' ? Math.ceil(q - EPS) : Math.round(q);
  return round2(n * increment);
}

/** Zwiększenie o co najmniej jeden krok; opcjonalnie o procent (zaokrąglony do kroku). */
export function increaseLoad(load: number, increment: number, pct = 0): number {
  const oneStep = round2(load + increment);
  if (pct <= 0) return oneStep;
  return Math.max(oneStep, roundToIncrement(load * (1 + pct), increment, 'nearest'));
}

/** Zmniejszenie o procent, ale zawsze co najmniej o jeden krok i nigdy poniżej zera. */
export function decreaseLoad(load: number, increment: number, pct: number): number {
  const byPct = roundToIncrement(load * (1 - pct), increment, 'down');
  const oneStep = round2(load - increment);
  return Math.max(0, Math.min(byPct, oneStep));
}

/** Ciężar dominujący w seriach: najczęstszy, przy remisie — wyższy. */
export function dominantLoad(sets: readonly LoggedSet[]): number | null {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (!isNumber(s.loadKg)) continue;
    counts.set(s.loadKg, (counts.get(s.loadKg) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [load, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && load > best)) {
      best = load;
      bestCount = count;
    }
  }
  return best;
}

/** RIR z serii: wprost albo przeliczony z RPE (RIR = 10 − RPE). */
export function effectiveRir(set: LoggedSet): number | null {
  if (isNumber(set.rir)) return clamp(set.rir, 0, 10);
  if (isNumber(set.rpe)) return clamp(10 - set.rpe, 0, 10);
  return null;
}

/**
 * Szacowany 1RM (wzór Epleya) z uwzględnieniem RIR:
 * powtórzenia do upadku = powtórzenia + RIR. Powyżej 15 wynik jest niewiarygodny → null.
 */
export function estimateOneRepMax(loadKg: number, reps: number, rir: number | null = 0): number | null {
  if (!(loadKg > 0) || !(reps > 0)) return null;
  const toFailure = reps + Math.max(0, rir ?? 0);
  if (toFailure > 15) return null;
  if (toFailure <= 1) return round1(loadKg);
  return round1(loadKg * (1 + toFailure / 30));
}

/** Najlepszy szacowany 1RM z ukończonych serii. */
export function bestE1rm(sets: readonly LoggedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!s.completed || !isNumber(s.loadKg)) continue;
    const e = estimateOneRepMax(s.loadKg, s.reps, effectiveRir(s));
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
}

export function uniform(count: number, value: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => value);
}
