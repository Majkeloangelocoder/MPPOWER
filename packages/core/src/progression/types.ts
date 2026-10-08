/**
 * Typy domenowe silnika progresji MP POWER.
 *
 * Silnik jest czystą funkcją: te same dane wejściowe zawsze dają tę samą
 * rekomendację. Dzięki temu każdą decyzję da się odtworzyć, wyjaśnić
 * i nadpisać (human override) — AI nie „zgaduje” ciężarów.
 */

export type ProgressionModel = 'double_progression' | 'rir' | 'rpe' | 'volume';
export type LoadType = 'external' | 'bodyweight' | 'time';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type Readiness = 'ok' | 'reduced';

/** Recepta ćwiczenia z planu (tabela program_exercises). Dla loadType 'time' powtórzenia = sekundy. */
export interface Prescription {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Docelowy zapas powtórzeń (RIR), np. 2. */
  targetRir: number;
  model: ProgressionModel;
  loadType: LoadType;
  /** Najmniejszy dostępny krok obciążenia dla tego ćwiczenia i użytkownika (kg). */
  loadIncrementKg: number;
  /** Limit serii dla progresji objętości. Domyślnie sets + 2. */
  maxSets?: number;
  /** Trudniejszy wariant (exercise_relations: progression) — dla ćwiczeń z masą ciała i na czas. */
  progressionExerciseId?: string | null;
}

/** Jedna zapisana seria robocza. */
export interface LoggedSet {
  /** null dla ćwiczeń z masą ciała i na czas */
  loadKg: number | null;
  /** powtórzenia; dla ćwiczeń na czas — sekundy */
  reps: number;
  rir?: number | null;
  rpe?: number | null;
  completed: boolean;
}

/** Jedno wykonanie ćwiczenia w sesji (tylko serie robocze). */
export interface ExerciseExposure {
  sessionId: string;
  performedAt: string;
  sets: LoggedSet[];
}

export interface ProgressionContext {
  level: ExperienceLevel;
  /** 'reduced' blokuje zwiększanie obciążenia (sen, zmęczenie). */
  readiness?: Readiness;
}

export type RecommendationAction =
  | 'calibrate'
  | 'increase_load'
  | 'hold_load'
  | 'decrease_load'
  | 'increase_reps'
  | 'add_set'
  | 'progress_variant';

export type ReasonCode =
  | 'NO_HISTORY'
  | 'ALL_SETS_AT_TOP'
  | 'RESERVE_OK'
  | 'RESERVE_LOW'
  | 'RIR_NOT_LOGGED'
  | 'REPS_BELOW_TOP'
  | 'REPS_BELOW_MIN'
  | 'REPS_BELOW_MIN_REPEATED'
  | 'INCOMPLETE_SETS'
  | 'RIR_ABOVE_TARGET'
  | 'RIR_ON_TARGET'
  | 'RIR_BELOW_TARGET'
  | 'RIR_FAR_BELOW_TARGET'
  | 'ADVANCED_HOLD'
  | 'VOLUME_STEP'
  | 'VOLUME_CAP'
  | 'VARIANT_AVAILABLE'
  | 'VARIANT_MISSING'
  | 'READINESS_REDUCED';

export interface Reason {
  code: ReasonCode;
  params?: Record<string, number | string>;
}

export interface NextTarget {
  /** Może się różnić od ćwiczenia wejściowego przy 'progress_variant'. */
  exerciseId: string;
  loadKg: number | null;
  sets: number;
  repMin: number;
  repMax: number;
  /** Minimalny cel na każdą serię (np. [8, 8, 8]). */
  repsPerSet: number[];
  targetRir: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Recommendation {
  exerciseId: string;
  model: ProgressionModel;
  action: RecommendationAction;
  next: NextTarget;
  reasons: Reason[];
  confidence: Confidence;
  /** Deterministyczne wyjaśnienie po polsku — można je pokazać bez udziału AI. */
  explanation: string;
  engineVersion: string;
}
