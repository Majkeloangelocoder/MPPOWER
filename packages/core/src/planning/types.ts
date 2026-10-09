import type { SexForCalc } from '../nutrition/targets.ts';
import type { ExperienceLevel, LoadType, ProgressionModel } from '../progression/types.ts';

/** Cel wybierany w ankiecie startowej (podzbiór goals.goal_type). */
export type TrainingGoal = 'fat_loss' | 'muscle_gain' | 'strength' | 'fitness';
export type TrainingLocation = 'gym' | 'home';
export type HomeEquipment = 'none' | 'dumbbells';
export type Limitation = 'knee' | 'shoulder' | 'lower_back' | 'wrist';

/** Obwody w cm (tabela measurements). Talia: najwęższe miejsce; brzuch: na wysokości pępka. */
export type CircumferenceKind = 'waist' | 'abdomen' | 'chest' | 'arm' | 'thigh' | 'hips';
export type Circumferences = Partial<Record<CircumferenceKind, number>>;

/** Odpowiedzi z ankiety startowej; każde pole może być jeszcze puste. */
export interface OnboardingProfile {
  goal?: TrainingGoal | null;
  level?: ExperienceLevel | null;
  sex?: SexForCalc | null;
  birthYear?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  daysPerWeek?: number | null;
  sessionMinutes?: number | null;
  location?: TrainingLocation | null;
  homeEquipment?: HomeEquipment | null;
  limitations?: Limitation[];
  circumferences?: Circumferences;
}

/** Ćwiczenie z biblioteki (tabela exercises) — tyle, ile potrzebuje generator. */
export interface LibraryExercise {
  id: string;
  name: string;
  category: 'squat' | 'hinge' | 'push' | 'pull' | 'carry' | 'lunge' | 'rotation' | 'core' | 'mobility' | 'conditioning';
  plane: 'horizontal' | 'vertical' | null;
  primaryMuscles: string[];
  equipment: string[];
  difficulty: number;
  loadType: LoadType;
  stressTags: string[];
}

export type Block = 'main' | 'accessory' | 'finisher';

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  loadType: LoadType;
  block: Block;
  sets: number;
  repMin: number;
  repMax: number;
  targetRir: number;
  restSeconds: number;
  tempo: string | null;
  model: ProgressionModel;
}

export interface PlannedDay {
  dayIndex: number;
  title: string;
  focus: string;
  estimatedMinutes: number;
  exercises: PlannedExercise[];
}

export type CyclePhase = 'intro' | 'build' | 'deload' | 'peak';

/** Modyfikator tygodnia nakładany na recepty z planu (tabela program_weeks). */
export interface WeekPlan {
  weekIndex: number;
  phase: CyclePhase;
  label: string;
  setsDelta: number;
  setsMultiplier: number;
  rirDelta: number;
  /** Ten tydzień nie zmienia celów progresji (odciążenie). */
  holdProgression: boolean;
  /** Przypomnienie o pomiarach kontrolnych. */
  checkIn: boolean;
  focus: string;
}

export interface GeneratedProgram {
  title: string;
  goal: TrainingGoal;
  level: ExperienceLevel;
  daysPerWeek: number;
  location: TrainingLocation;
  cycleWeeks: number;
  days: PlannedDay[];
  weeks: WeekPlan[];
  /** Krótkie uzasadnienia decyzji generatora, pokazywane użytkownikowi. */
  insights: string[];
  generatorVersion: string;
}
