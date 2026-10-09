import type { CircumferenceKind, OnboardingProfile } from './types.ts';

/** Obwody wymagane do zaprojektowania planu (biodra są opcjonalne). */
export const REQUIRED_CIRCUMFERENCES: readonly CircumferenceKind[] = ['waist', 'abdomen', 'chest', 'arm', 'thigh'];

export const CIRCUMFERENCE_LABELS: Readonly<Record<CircumferenceKind, string>> = {
  waist: 'talia',
  abdomen: 'brzuch',
  chest: 'klatka piersiowa',
  arm: 'ramię',
  thigh: 'udo',
  hips: 'biodra',
};

/** Rozsądne zakresy wartości (cm / kg / lata) — chronią przed literówkami typu 850 zamiast 85. */
export const PROFILE_LIMITS = {
  heightCm: [120, 230],
  weightKg: [35, 300],
  circumference: [15, 250],
  daysPerWeek: [2, 6],
  sessionMinutes: [30, 90],
} as const;

export type ProfileField =
  | 'goal' | 'level' | 'sex' | 'birthYear' | 'heightCm' | 'weightKg' | 'daysPerWeek' | 'location' | `circumference.${CircumferenceKind}`;

export interface ProfileCompleteness {
  /** Komplet danych do zaprojektowania planu na cały cykl. */
  complete: boolean;
  missing: ProfileField[];
  /** 0–100, do paska postępu. */
  percent: number;
}

const inRange = (v: number | null | undefined, [min, max]: readonly [number, number]) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return now.getFullYear() - birthYear;
}

export function profileCompleteness(p: OnboardingProfile, now: Date = new Date()): ProfileCompleteness {
  const missing: ProfileField[] = [];
  if (!p.goal) missing.push('goal');
  if (!p.level) missing.push('level');
  if (!p.sex) missing.push('sex');
  if (!p.birthYear || !inRange(ageFromBirthYear(p.birthYear, now), [18, 100])) missing.push('birthYear');
  if (!inRange(p.heightCm, PROFILE_LIMITS.heightCm)) missing.push('heightCm');
  if (!inRange(p.weightKg, PROFILE_LIMITS.weightKg)) missing.push('weightKg');
  if (!inRange(p.daysPerWeek, PROFILE_LIMITS.daysPerWeek)) missing.push('daysPerWeek');
  if (!p.location || (p.location === 'home' && !p.homeEquipment)) missing.push('location');
  for (const kind of REQUIRED_CIRCUMFERENCES) {
    if (!inRange(p.circumferences?.[kind], PROFILE_LIMITS.circumference)) missing.push(`circumference.${kind}`);
  }
  const total = 8 + REQUIRED_CIRCUMFERENCES.length;
  return { complete: missing.length === 0, missing, percent: Math.round(((total - missing.length) / total) * 100) };
}

/** Stosunek obwodu talii do wzrostu; ≥ 0,5 to powszechnie stosowany próg przesiewowy. */
export function waistToHeightRatio(waistCm: number, heightCm: number): number {
  return Math.round((waistCm / heightCm) * 100) / 100;
}
