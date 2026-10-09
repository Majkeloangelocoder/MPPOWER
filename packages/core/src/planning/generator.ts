import { computeNutritionTargets, type NutritionTargets } from '../nutrition/targets.ts';
import type { ExperienceLevel } from '../progression/types.ts';
import { buildCycleWeeks, CYCLE_WEEKS } from './cycle.ts';
import { ageFromBirthYear, profileCompleteness, waistToHeightRatio } from './profile.ts';
import type {
  Block,
  GeneratedProgram,
  LibraryExercise,
  Limitation,
  OnboardingProfile,
  PlannedDay,
  PlannedExercise,
  TrainingGoal,
} from './types.ts';

export const GENERATOR_VERSION = 'cycle-generator@1.0.0';

/** Wzorzec ruchu, pod który generator dobiera ćwiczenie z biblioteki. */
type Slot = 'squat' | 'hinge' | 'push_h' | 'push_v' | 'pull_h' | 'pull_v' | 'lunge' | 'core' | 'biceps' | 'triceps' | 'conditioning';

interface DayTemplate {
  title: string;
  focus: string;
  /** Kolejność = priorytet; przy krótszej sesji odpadają ostatnie. */
  slots: Slot[];
}

const FULL_A: DayTemplate = { title: 'Full Body A', focus: 'przysiad, wyciskanie, wiosłowanie', slots: ['squat', 'push_h', 'pull_h', 'hinge', 'core', 'biceps', 'triceps'] };
const FULL_B: DayTemplate = { title: 'Full Body B', focus: 'zawias biodrowy, wyciskanie nad głowę, przyciąganie', slots: ['hinge', 'push_v', 'pull_v', 'lunge', 'core', 'triceps', 'biceps'] };
const FULL_C: DayTemplate = { title: 'Full Body C', focus: 'wykroki, wyciskanie, wiosłowanie', slots: ['lunge', 'push_h', 'pull_h', 'hinge', 'core', 'biceps', 'triceps'] };
const UPPER_1: DayTemplate = { title: 'Góra A', focus: 'klatka, plecy, barki, ramiona', slots: ['push_h', 'pull_h', 'push_v', 'pull_v', 'biceps', 'triceps', 'core'] };
const LOWER_1: DayTemplate = { title: 'Dół A', focus: 'przysiad, zawias biodrowy, wykroki', slots: ['squat', 'hinge', 'lunge', 'core', 'squat'] };
const UPPER_2: DayTemplate = { title: 'Góra B', focus: 'barki, plecy, klatka, ramiona', slots: ['push_v', 'pull_v', 'push_h', 'pull_h', 'triceps', 'biceps', 'core'] };
const LOWER_2: DayTemplate = { title: 'Dół B', focus: 'zawias biodrowy, przysiad, wykroki', slots: ['hinge', 'squat', 'lunge', 'core', 'hinge'] };
const PUSH: DayTemplate = { title: 'Pchanie', focus: 'klatka, barki, triceps', slots: ['push_h', 'push_v', 'push_h', 'triceps', 'core'] };
const PULL: DayTemplate = { title: 'Przyciąganie', focus: 'plecy, biceps', slots: ['pull_h', 'pull_v', 'pull_h', 'biceps', 'core'] };
const LEGS: DayTemplate = { title: 'Nogi', focus: 'przysiad, zawias biodrowy, wykroki', slots: ['squat', 'hinge', 'lunge', 'core', 'squat'] };

function splitFor(days: number): DayTemplate[] {
  if (days <= 2) return [FULL_A, FULL_B];
  if (days === 3) return [FULL_A, FULL_B, FULL_C];
  if (days === 4) return [UPPER_1, LOWER_1, UPPER_2, LOWER_2];
  if (days === 5) return [UPPER_1, LOWER_1, UPPER_2, LOWER_2, FULL_A];
  return [PUSH, PULL, LEGS, { ...PUSH, title: 'Pchanie B' }, { ...PULL, title: 'Przyciąganie B' }, { ...LEGS, title: 'Nogi B' }];
}

/** Ile ćwiczeń mieści się w sesji (łącznie z ewentualnym finiszerem). */
function exercisesFor(minutes: number): number {
  if (minutes <= 30) return 4;
  if (minutes <= 45) return 5;
  if (minutes <= 60) return 6;
  return 7;
}

interface Dose { sets: number; repMin: number; repMax: number; rir: number; rest: number }
const DOSES: Readonly<Record<TrainingGoal, { main: Dose; accessory: Dose }>> = {
  strength: { main: { sets: 4, repMin: 4, repMax: 6, rir: 2, rest: 180 }, accessory: { sets: 3, repMin: 8, repMax: 10, rir: 2, rest: 90 } },
  muscle_gain: { main: { sets: 3, repMin: 6, repMax: 10, rir: 2, rest: 120 }, accessory: { sets: 3, repMin: 10, repMax: 15, rir: 1, rest: 75 } },
  fat_loss: { main: { sets: 3, repMin: 8, repMax: 12, rir: 2, rest: 90 }, accessory: { sets: 3, repMin: 12, repMax: 15, rir: 2, rest: 60 } },
  fitness: { main: { sets: 3, repMin: 10, repMax: 12, rir: 2, rest: 90 }, accessory: { sets: 2, repMin: 12, repMax: 15, rir: 2, rest: 60 } },
};

const LEVEL_SETS: Readonly<Record<ExperienceLevel, number>> = { beginner: 0, intermediate: 0, advanced: 1 };
const LEVEL_RIR: Readonly<Record<ExperienceLevel, number>> = { beginner: 1, intermediate: 0, advanced: 0 };
const MAX_DIFFICULTY: Readonly<Record<ExperienceLevel, number>> = { beginner: 2, intermediate: 3, advanced: 5 };
const PREFERRED_DIFFICULTY: Readonly<Record<ExperienceLevel, number>> = { beginner: 1.5, intermediate: 2.5, advanced: 3.5 };

const AVOID_TAGS: Readonly<Record<Limitation, string[]>> = {
  knee: ['knee_deep_flexion'],
  shoulder: ['shoulder_overhead'],
  lower_back: ['spinal_axial_load', 'spinal_flexion_load'],
  wrist: ['wrist_extension'],
};
const LIMITATION_LABELS: Readonly<Record<Limitation, string>> = { knee: 'kolano', shoulder: 'bark', lower_back: 'dolny odcinek pleców', wrist: 'nadgarstek' };

const HOME_EQUIPMENT: Readonly<Record<'none' | 'dumbbells', ReadonlySet<string>>> = {
  none: new Set(['bodyweight', 'mat', 'box']),
  dumbbells: new Set(['bodyweight', 'mat', 'box', 'dumbbells', 'bench']),
};

const isArm = (e: LibraryExercise, muscle: string) => e.plane === null && e.primaryMuscles.includes(muscle);

function matchesSlot(e: LibraryExercise, slot: Slot): boolean {
  switch (slot) {
    case 'squat': return e.category === 'squat';
    case 'hinge': return e.category === 'hinge';
    case 'lunge': return e.category === 'lunge';
    case 'push_h': return e.category === 'push' && e.plane === 'horizontal';
    case 'push_v': return e.category === 'push' && e.plane === 'vertical';
    case 'pull_h': return e.category === 'pull' && e.plane === 'horizontal';
    case 'pull_v': return e.category === 'pull' && e.plane === 'vertical';
    case 'core': return e.category === 'core';
    case 'biceps': return isArm(e, 'biceps');
    case 'triceps': return isArm(e, 'triceps');
    case 'conditioning': return e.category === 'conditioning';
  }
}

const FALLBACK_SLOTS: readonly Slot[] = ['squat', 'push_h', 'pull_h', 'core', 'hinge'];
const ACCESSORY_SLOTS: ReadonlySet<Slot> = new Set(['core', 'biceps', 'triceps']);

function dose(goal: TrainingGoal, level: ExperienceLevel, block: Block, e: LibraryExercise): Omit<PlannedExercise, 'exerciseId' | 'name' | 'block' | 'loadType'> {
  if (block === 'finisher') {
    return { sets: 3, repMin: 30, repMax: 45, targetRir: 2, restSeconds: 30, tempo: null, model: 'double_progression' };
  }
  const d = DOSES[goal][block];
  const sets = Math.max(2, Math.min(6, d.sets + (block === 'main' ? LEVEL_SETS[level] : Math.min(0, LEVEL_SETS[level]))));
  const targetRir = Math.min(4, d.rir + LEVEL_RIR[level]);
  if (e.loadType === 'time') {
    const [repMin, repMax] = level === 'advanced' ? [30, 60] : [20, 40];
    return { sets, repMin, repMax, targetRir, restSeconds: 60, tempo: null, model: 'double_progression' };
  }
  // Ćwiczenia z masą ciała: szerszy zakres powtórzeń, bo nie da się dołożyć ciężaru.
  const [repMin, repMax] = e.loadType === 'bodyweight' ? [Math.max(6, d.repMin), Math.max(15, d.repMax)] : [d.repMin, d.repMax];
  return { sets, repMin, repMax, targetRir, restSeconds: d.rest, tempo: block === 'main' ? '2-0-1-0' : null, model: 'double_progression' };
}

export class ProfileIncompleteError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super('Uzupełnij profil i pomiary, aby zaprojektować plan.');
    this.missing = missing;
  }
}

export interface GeneratedPlan {
  program: GeneratedProgram;
  nutrition: NutritionTargets | null;
}

/**
 * Projektuje plan na cały cykl (8 tygodni) z ankiety, pomiarów i biblioteki ćwiczeń.
 * Funkcja czysta i deterministyczna: te same dane → ten sam plan (da się go odtworzyć i wyjaśnić).
 */
export function generateCyclePlan(profile: OnboardingProfile, library: readonly LibraryExercise[], now: Date = new Date()): GeneratedPlan {
  const status = profileCompleteness(profile, now);
  if (!status.complete) throw new ProfileIncompleteError(status.missing);
  const goal = profile.goal!;
  const level = profile.level!;
  const daysPerWeek = profile.daysPerWeek!;
  const minutes = profile.sessionMinutes ?? 60;
  const limitations = [...new Set(profile.limitations ?? [])];
  const insights: string[] = [];

  const avoid = new Set(limitations.flatMap((l) => AVOID_TAGS[l]));
  const equipment = profile.location === 'home' ? HOME_EQUIPMENT[profile.homeEquipment ?? 'none'] : null;
  const pool = library.filter(
    (e) =>
      e.difficulty <= MAX_DIFFICULTY[level] &&
      !e.stressTags.some((t) => avoid.has(t)) &&
      (equipment === null || e.equipment.every((q) => equipment.has(q))),
  );

  // Talia względem wzrostu: przy ≥ 0,5 albo celu „schudnąć/kondycja” plan dostaje krótki finiszer kondycyjny.
  const whtr = waistToHeightRatio(profile.circumferences!.waist!, profile.heightCm!);
  const wantsConditioning = goal === 'fat_loss' || goal === 'fitness' || whtr >= 0.5;
  const hasConditioning = pool.some((e) => matchesSlot(e, 'conditioning'));

  const used = new Map<string, number>();
  const skippedSlots = new Set<Slot>();
  const pick = (slot: Slot, takenToday: Set<string>, main = false): LibraryExercise | null => {
    let candidates = pool.filter((e) => matchesSlot(e, slot) && !takenToday.has(e.id));
    // Na siłowni główne ćwiczenia zawsze z obciążeniem, jeśli biblioteka ma taki wariant.
    if (main && profile.location === 'gym' && candidates.some((e) => e.loadType === 'external')) {
      candidates = candidates.filter((e) => e.loadType === 'external');
    }
    if (candidates.length === 0) return null;
    const gym = profile.location === 'gym';
    const score = (e: LibraryExercise) =>
      (used.get(e.id) ?? 0) * 10 + // różnorodność między dniami
      Math.abs(e.difficulty - PREFERRED_DIFFICULTY[level]) -
      (gym && e.loadType === 'external' ? 2 : 0); // na siłowni progres obciążeniem jest najpewniejszy
    return [...candidates].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'pl'))[0]!;
  };

  const maxExercises = exercisesFor(minutes);
  const days: PlannedDay[] = splitFor(daysPerWeek).map((template, i) => {
    const takenToday = new Set<string>();
    const exercises: PlannedExercise[] = [];
    const finisher = wantsConditioning && hasConditioning;
    const limit = finisher ? maxExercises - 1 : maxExercises;
    const target = Math.min(limit, template.slots.length);
    const add = (slot: Slot): boolean => {
      const block: Block = ACCESSORY_SLOTS.has(slot) || exercises.length >= 3 ? 'accessory' : 'main';
      const e = pick(slot, takenToday, block === 'main');
      if (!e) return false;
      takenToday.add(e.id);
      used.set(e.id, (used.get(e.id) ?? 0) + 1);
      exercises.push({ exerciseId: e.id, name: e.name, loadType: e.loadType, block, ...dose(goal, level, block, e) });
      return true;
    };
    for (const slot of template.slots) {
      if (exercises.length >= target) break;
      if (!add(slot)) skippedSlots.add(slot);
    }
    // Brak sprzętu na któryś wzorzec → dzień uzupełniają podstawowe wzorce.
    for (const slot of FALLBACK_SLOTS) {
      if (exercises.length >= target) break;
      add(slot);
    }
    if (finisher) {
      const e = pick('conditioning', takenToday);
      if (e) exercises.push({ exerciseId: e.id, name: e.name, loadType: e.loadType, block: 'finisher', ...dose(goal, level, 'finisher', e) });
    }
    const workSeconds = exercises.reduce((sum, x) => sum + x.sets * (x.restSeconds + 45), 0);
    return {
      dayIndex: i + 1,
      title: template.title,
      focus: template.focus,
      estimatedMinutes: Math.min(240, Math.max(5, Math.round((workSeconds / 60 + 8) / 5) * 5)),
      exercises,
    };
  });

  const goalText: Record<TrainingGoal, string> = {
    fat_loss: 'redukcja tkanki tłuszczowej przy zachowaniu mięśni: umiarkowane ciężary, krótsze przerwy',
    muscle_gain: 'budowa mięśni: 6–10 powtórzeń w głównych ćwiczeniach, 10–15 w akcesoriach',
    strength: 'siła: 4–6 powtórzeń w głównych ćwiczeniach i długie przerwy',
    fitness: 'kondycja i zdrowie: umiarkowana objętość i element kondycyjny',
  };
  insights.push(`Cel: ${goalText[goal]}.`);
  insights.push(`${daysPerWeek} ${daysPerWeek < 5 ? 'treningi' : 'treningów'} w tygodniu po ok. ${minutes} min: ${days.map((d) => d.title).join(', ')}.`);
  if (whtr >= 0.5) {
    insights.push(`Talia ${profile.circumferences!.waist} cm przy wzroście ${profile.heightCm} cm (stosunek ${whtr.toFixed(2).replace('.', ',')}) — ${hasConditioning ? 'dodaliśmy krótki finiszer kondycyjny' : 'warto dodać spacery lub rower'}. Obwód talii to główny wskaźnik postępu w tym cyklu.`);
  } else {
    insights.push('Obwody z dnia startu to punkt odniesienia: porównamy je w tygodniu 4 i 8.');
  }
  if (limitations.length > 0) {
    insights.push(`Ograniczenia (${limitations.map((l) => LIMITATION_LABELS[l]).join(', ')}): pominęliśmy ćwiczenia, które je obciążają. Ból w trakcie ćwiczenia = przerwij i skonsultuj się ze specjalistą.`);
  }
  if (profile.location === 'home') {
    insights.push(profile.homeEquipment === 'dumbbells' ? 'Plan domowy: masa ciała i hantle.' : 'Plan domowy bez sprzętu: progres przez powtórzenia i trudniejsze warianty.');
  }
  if (skippedSlots.size > 0 && profile.location === 'home' && skippedSlots.has('pull_v')) {
    insights.push('Bez drążka nie ma przyciągania pionowego — zastępuje je wiosłowanie.');
  }

  const age = ageFromBirthYear(profile.birthYear!, now);
  const nutritionResult = computeNutritionTargets({
    sex: profile.sex!,
    ageYears: age,
    heightCm: profile.heightCm!,
    weightKg: profile.weightKg!,
    activity: daysPerWeek <= 3 ? 'light' : daysPerWeek <= 5 ? 'moderate' : 'high',
    goal: goal === 'fat_loss' ? 'fat_loss' : goal === 'muscle_gain' ? 'muscle_gain' : 'maintenance',
    level,
  });

  const goalTitle: Record<TrainingGoal, string> = { fat_loss: 'Redukcja', muscle_gain: 'Budowa mięśni', strength: 'Siła', fitness: 'Kondycja' };
  return {
    program: {
      title: `${goalTitle[goal]} — cykl ${CYCLE_WEEKS} tygodni`,
      goal,
      level,
      daysPerWeek,
      location: profile.location!,
      cycleWeeks: CYCLE_WEEKS,
      days,
      weeks: buildCycleWeeks(goal, level),
      insights,
      generatorVersion: GENERATOR_VERSION,
    },
    nutrition: nutritionResult.ok ? nutritionResult.targets : null,
  };
}
