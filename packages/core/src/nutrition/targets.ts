import type { ExperienceLevel } from '../progression/types.ts';

export const NUTRITION_VERSION = 'nutrition@1.0.0';

export type SexForCalc = 'female' | 'male' | 'unspecified';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high' | 'very_high';
export type NutritionGoal = 'fat_loss' | 'muscle_gain' | 'maintenance' | 'recomposition';

export const ACTIVITY_FACTORS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

const SEX_OFFSET: Readonly<Record<SexForCalc, number>> = { male: 5, female: -161, unspecified: -78 };
/** Bezpiecznik: kalorie nigdy poniżej max(tej wartości, BMR) bez nadzoru specjalisty. */
const SEX_FLOOR_KCAL: Readonly<Record<SexForCalc, number>> = { male: 1500, female: 1200, unspecified: 1350 };
const SURPLUS: Readonly<Record<ExperienceLevel, number>> = { beginner: 0.1, intermediate: 0.075, advanced: 0.05 };
/** Gramy białka na kg masy referencyjnej: [min, cel, max]. */
const PROTEIN_PER_KG: Readonly<Record<NutritionGoal, readonly [number, number, number]>> = {
  fat_loss: [1.8, 2.0, 2.2],
  muscle_gain: [1.6, 1.8, 2.2],
  maintenance: [1.4, 1.6, 2.0],
  recomposition: [1.8, 2.0, 2.2],
};

export interface NutritionInput {
  sex: SexForCalc;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
  level?: ExperienceLevel;
  /** Docelowe tempo redukcji w % masy ciała tygodniowo (domyślnie 0,5; maks. 1). */
  weeklyLossPct?: number;
}

export type NutritionFlag =
  | 'RATE_CAPPED'
  | 'DEFICIT_CAPPED'
  | 'CALORIE_FLOOR_APPLIED'
  | 'ADJUSTED_PROTEIN_REFERENCE'
  | 'LOW_CARB_RESULT';

export interface NutritionTargets {
  method: 'mifflin_st_jeor';
  bmrKcal: number;
  tdeeKcal: number;
  caloriesKcal: number;
  proteinG: number;
  proteinRangeG: [number, number];
  fatG: number;
  carbsG: number;
  fiberG: number;
  flags: NutritionFlag[];
  engineVersion: string;
}

export type NutritionResult =
  | { ok: true; targets: NutritionTargets }
  | { ok: false; reason: 'UNDER_18' | 'INVALID_INPUT'; message: string };

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

export function bmrMifflinStJeor(i: Pick<NutritionInput, 'sex' | 'ageYears' | 'heightCm' | 'weightKg'>): number {
  return 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.ageYears + SEX_OFFSET[i.sex];
}

/**
 * Orientacyjne cele: BMR (Mifflin-St Jeor) × współczynnik aktywności, korekta pod cel,
 * bezpieczniki (maks. deficyt 25% TDEE, dolna granica kalorii), białko liczone od masy referencyjnej.
 * Po 2–3 tygodniach zapisów cele koryguje adaptacyjne TDEE (MVP2).
 */
export function computeNutritionTargets(input: NutritionInput): NutritionResult {
  if (input.ageYears < 18) {
    return { ok: false, reason: 'UNDER_18', message: 'Cele kaloryczne wyznaczamy wyłącznie osobom pełnoletnim.' };
  }
  const valid =
    input.ageYears <= 100 &&
    input.heightCm >= 120 &&
    input.heightCm <= 230 &&
    input.weightKg >= 35 &&
    input.weightKg <= 300;
  if (!valid) return { ok: false, reason: 'INVALID_INPUT', message: 'Sprawdź wiek, wzrost i masę ciała.' };

  const flags: NutritionFlag[] = [];
  const bmr = bmrMifflinStJeor(input);
  const tdee = bmr * ACTIVITY_FACTORS[input.activity];

  let calories = tdee;
  if (input.goal === 'fat_loss') {
    let rate = input.weeklyLossPct ?? 0.5;
    if (rate > 1) {
      rate = 1;
      flags.push('RATE_CAPPED');
    }
    rate = Math.max(0, rate);
    let deficit = (input.weightKg * (rate / 100) * 7700) / 7;
    if (deficit > 0.25 * tdee) {
      deficit = 0.25 * tdee;
      flags.push('DEFICIT_CAPPED');
    }
    calories = tdee - deficit;
  } else if (input.goal === 'muscle_gain') {
    calories = tdee * (1 + SURPLUS[input.level ?? 'intermediate']);
  }

  const floor = Math.max(SEX_FLOOR_KCAL[input.sex], bmr);
  let caloriesKcal = roundTo(calories, 10);
  if (calories < floor) {
    flags.push('CALORIE_FLOOR_APPLIED');
    caloriesKcal = ceilTo(floor, 10);
  } else if (caloriesKcal < floor) {
    caloriesKcal = ceilTo(floor, 10);
  }

  const h = input.heightCm / 100;
  let refWeight = input.weightKg;
  if (input.weightKg / (h * h) >= 30) {
    const atBmi25 = 25 * h * h;
    refWeight = atBmi25 + 0.4 * (input.weightKg - atBmi25);
    flags.push('ADJUSTED_PROTEIN_REFERENCE');
  }
  const [pMin, pTarget, pMax] = PROTEIN_PER_KG[input.goal];
  const proteinG = roundTo(refWeight * pTarget, 5);
  const fatG = Math.round(Math.max(0.6 * refWeight, (caloriesKcal * 0.25) / 9));
  const carbsG = Math.max(0, Math.round((caloriesKcal - proteinG * 4 - fatG * 9) / 4));
  if (carbsG < 100) flags.push('LOW_CARB_RESULT');

  return {
    ok: true,
    targets: {
      method: 'mifflin_st_jeor',
      bmrKcal: Math.round(bmr),
      tdeeKcal: Math.round(tdee),
      caloriesKcal,
      proteinG,
      proteinRangeG: [roundTo(refWeight * pMin, 5), roundTo(refWeight * pMax, 5)],
      fatG,
      carbsG,
      fiberG: Math.max(25, Math.round((14 * caloriesKcal) / 1000)),
      flags,
      engineVersion: NUTRITION_VERSION,
    },
  };
}

/** „Brakuje 45 g białka”: ile zostało do celu na dziś. */
export function dailyGap(
  targets: Pick<NutritionTargets, 'caloriesKcal' | 'proteinG'>,
  consumed: { kcal: number; proteinG: number },
): { kcalLeft: number; proteinLeftG: number } {
  return {
    kcalLeft: Math.round(targets.caloriesKcal - consumed.kcal),
    proteinLeftG: Math.max(0, Math.round(targets.proteinG - consumed.proteinG)),
  };
}
