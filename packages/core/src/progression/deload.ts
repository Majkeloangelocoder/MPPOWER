import { formatNumber } from './explain.ts';
import { bestE1rm, effectiveRir, isNumber, mean, round1 } from './math.ts';
import type { ExerciseExposure, Readiness } from './types.ts';

export const DELOAD_VERSION = 'deload@1.0.0';
/** Suma wag sygnałów, od której proponujemy lżejszy tydzień. */
export const DELOAD_THRESHOLD = 3;
const DAY_MS = 86_400_000;

export interface KeyLiftHistory {
  exerciseId: string;
  targetRir: number;
  /** Od najstarszego do najnowszego wykonania. */
  exposures: readonly ExerciseExposure[];
}

export interface RecoveryEntry {
  /** YYYY-MM-DD */
  date: string;
  sleepHours?: number | null;
  /** 1–5, gdzie 5 = skrajne zmęczenie */
  fatigue?: number | null;
}

export interface DeloadInput {
  now: string;
  /** Początek bloku albo data ostatniego deloadu. */
  blockStartedAt: string;
  /** Realizacja planu w ostatnich 4 tygodniach (0–1). */
  adherence?: number | null;
  keyLifts: readonly KeyLiftHistory[];
  recovery?: readonly RecoveryEntry[];
}

export type DeloadSignalCode =
  | 'PERFORMANCE_DECLINE'
  | 'EFFORT_CREEP'
  | 'POOR_SLEEP'
  | 'HIGH_FATIGUE'
  | 'ACCUMULATED_WEEKS';

export interface DeloadSignal {
  code: DeloadSignalCode;
  weight: number;
  params: Record<string, number>;
}

export interface DeloadProposal {
  durationDays: number;
  volumeMultiplier: number;
  loadMultiplier: number;
}

export interface DeloadAssessment {
  recommend: boolean;
  score: number;
  signals: DeloadSignal[];
  proposal: DeloadProposal | null;
  explanation: string;
  engineVersion: string;
}

/**
 * Wykrywa potencjalne przeciążenie z kilku niezależnych sygnałów.
 * Nigdy nie wprowadza deloadu sam — zwraca propozycję do akceptacji użytkownika lub trenera.
 */
export function assessDeload(input: DeloadInput): DeloadAssessment {
  const signals: DeloadSignal[] = [];
  const nowMs = Date.parse(input.now);

  let declining = 0;
  let creeping = 0;
  for (const lift of input.keyLifts) {
    const e1rms = lift.exposures.map((e) => bestE1rm(e.sets)).filter(isNumber);
    if (e1rms.length >= 4) {
      const best = Math.max(...e1rms.slice(-6, -2));
      if (e1rms.slice(-2).every((v) => v < best * 0.97)) declining += 1;
    }
    const lastTwo = lift.exposures.slice(-2);
    const harder = lastTwo.length === 2 && lastTwo.every((e) => {
      const rirs = e.sets.filter((s) => s.completed).map((s) => effectiveRir(s)).filter(isNumber);
      return rirs.length > 0 && mean(rirs) <= lift.targetRir - 2;
    });
    if (harder) creeping += 1;
  }
  if (declining > 0) signals.push({ code: 'PERFORMANCE_DECLINE', weight: declining >= 2 ? 2 : 1, params: { lifts: declining } });
  if (creeping > 0) signals.push({ code: 'EFFORT_CREEP', weight: creeping >= 2 ? 2 : 1, params: { lifts: creeping } });

  const week = recentEntries(input.recovery ?? [], nowMs, 7);
  const sleeps = week.map((r) => r.sleepHours).filter(isNumber);
  if (sleeps.length >= 4 && mean(sleeps) < 6) {
    signals.push({ code: 'POOR_SLEEP', weight: 1, params: { avgSleep: round1(mean(sleeps)) } });
  }
  const tiredDays = week.filter((r) => isNumber(r.fatigue) && r.fatigue >= 4).length;
  if (tiredDays >= 3) signals.push({ code: 'HIGH_FATIGUE', weight: 1, params: { days: tiredDays } });

  const weeks = Math.floor((nowMs - Date.parse(input.blockStartedAt)) / (7 * DAY_MS));
  if (weeks >= 6 && (input.adherence ?? 1) >= 0.75) {
    signals.push({ code: 'ACCUMULATED_WEEKS', weight: weeks >= 8 ? 2 : 1, params: { weeks } });
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const recommend = score >= DELOAD_THRESHOLD;
  return {
    recommend,
    score,
    signals,
    proposal: recommend ? { durationDays: 7, volumeMultiplier: 0.5, loadMultiplier: 0.9 } : null,
    explanation: explainDeload(recommend, signals),
    engineVersion: DELOAD_VERSION,
  };
}

/** Gotowość na dziś (ostatnie 3 dni): zmęczenie ≥ 4 albo średnio < 6 h snu → 'reduced'. */
export function assessReadiness(entries: readonly RecoveryEntry[], now: string): Readiness {
  const recent = recentEntries(entries, Date.parse(now), 3);
  if (recent.some((r) => isNumber(r.fatigue) && r.fatigue >= 4)) return 'reduced';
  const sleeps = recent.map((r) => r.sleepHours).filter(isNumber);
  if (sleeps.length >= 2 && mean(sleeps) < 6) return 'reduced';
  return 'ok';
}

function recentEntries(entries: readonly RecoveryEntry[], nowMs: number, days: number): RecoveryEntry[] {
  return entries.filter((r) => {
    const t = Date.parse(r.date);
    return t > nowMs - days * DAY_MS && t <= nowMs;
  });
}

function signalText(s: DeloadSignal): string {
  switch (s.code) {
    case 'PERFORMANCE_DECLINE':
      return `wyniki spadają w ćwiczeniach głównych (${s.params.lifts})`;
    case 'EFFORT_CREEP':
      return `te same ciężary są wyraźnie cięższe niż w planie (${s.params.lifts} ćw.)`;
    case 'POOR_SLEEP':
      return `średnio ${formatNumber(s.params.avgSleep ?? 0, 1)} h snu w ostatnim tygodniu`;
    case 'HIGH_FATIGUE':
      return `wysokie zmęczenie w ${s.params.days} z ostatnich 7 dni`;
    case 'ACCUMULATED_WEEKS':
      return `${s.params.weeks} tyg. treningu bez lżejszego tygodnia`;
  }
}

function explainDeload(recommend: boolean, signals: readonly DeloadSignal[]): string {
  const list = signals.map(signalText).join('; ');
  if (recommend) {
    return `Proponujemy lżejszy tydzień (deload): połowa serii i ciężary ok. 10% niżej przez 7 dni. Powody: ${list}.`;
  }
  if (signals.length > 0) return `Na razie bez deloadu. Obserwujemy: ${list}.`;
  return 'Na razie bez deloadu — wyniki i regeneracja są stabilne.';
}
