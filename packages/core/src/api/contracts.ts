import type { NutritionTargets } from '../nutrition/targets.ts';
import type { ProfileCompleteness } from '../planning/profile.ts';
import type { CyclePhase, GeneratedProgram, OnboardingProfile } from '../planning/types.ts';
import type { RecordKind } from '../progression/records.ts';
import type { Confidence, LoadType, NextTarget, ProgressionModel, RecommendationAction } from '../progression/types.ts';

/** Kontrakty API współdzielone przez aplikację mobilną i serwer (jedno źródło typów). */

export interface PlayerPrescription {
  sets: number;
  repMin: number;
  repMax: number;
  targetRir: number;
  restSeconds: number;
  tempo: string | null;
  model: ProgressionModel;
  notes: string | null;
}

export interface PlayerExercise {
  sessionExerciseId: string;
  exerciseId: string;
  name: string;
  loadType: LoadType;
  orderIndex: number;
  prescription: PlayerPrescription;
  /** Cel z ostatniej rekomendacji lub nadpisania trenera; null = pierwsze wykonanie. */
  target: NextTarget | null;
  /** Wyjaśnienie ostatniej rekomendacji („Dlaczego?”). */
  why: string | null;
}

export interface PlayerPayload {
  sessionId: string;
  title: string | null;
  startedAt: string;
  /** Tydzień cyklu (plan spersonalizowany); null w planie ogólnym. */
  cycle?: HomeCycle | null;
  exercises: PlayerExercise[];
}

export interface StartSessionRequest {
  programDayId: string;
  /** UUID wygenerowany na telefonie — ponowne wysłanie nie tworzy duplikatu. */
  clientSessionId: string;
}

export type SetType = 'warmup' | 'working' | 'backoff';

export interface LoggedSetInput {
  sessionExerciseId: string;
  setIndex: number;
  setType?: SetType;
  loadKg: number | null;
  reps: number;
  rir?: number | null;
  rpe?: number | null;
  completed: boolean;
}

export interface CompleteSessionRequest {
  sets: LoggedSetInput[];
  skippedSessionExerciseIds?: string[];
  swaps?: Array<{ sessionExerciseId: string; exerciseId: string }>;
  sessionRpe?: number | null;
  completedAt?: string;
}

export interface ReviewRecord {
  exerciseId: string;
  exerciseName: string;
  kind: RecordKind;
  value: number;
  improvement: number | null;
}

export interface ReviewTarget {
  exerciseId: string;
  exerciseName: string;
  loadType: LoadType;
  action: RecommendationAction;
  confidence: Confidence;
  next: NextTarget;
  explanation: string;
}

export interface SessionReviewText {
  headline: string;
  summary: string;
  nextFocus: string;
  source: 'ai' | 'rules';
}

export interface CompleteSessionResponse {
  sessionId: string;
  /** true = sesja była już zapisana (ponowna wysyłka z telefonu). */
  alreadyCompleted: boolean;
  score: number;
  review: SessionReviewText;
  records: ReviewRecord[];
  nextTargets: ReviewTarget[];
}

export interface EntitlementsResponse {
  planCode: string;
  validUntil: string | null;
  inGracePeriod: boolean;
  features: Record<string, { enabled: boolean; quota: { limit: number; period: string } | null }>;
}

export interface ApiErrorBody {
  error: { code: string; message?: string };
}

// ---------------------------------------------------------------------------
// Profil startowy i plan na cykl
// ---------------------------------------------------------------------------

export type PhotoPose = 'front' | 'side' | 'back';

export interface ProgressPhoto {
  id: string;
  pose: PhotoPose;
  takenAt: string;
  /** Podpisany adres ważny ok. godzinę (prywatny kubełek). */
  url: string | null;
}

export interface ProfileResponse {
  profile: OnboardingProfile;
  completeness: ProfileCompleteness;
  consents: { healthData: boolean; bodyImages: boolean };
  photos: ProgressPhoto[];
}

/** Zapis kroku ankiety: wysyłane są tylko zmienione pola. */
export interface UpdateProfileRequest extends OnboardingProfile {
  consents?: { healthData?: boolean; bodyImages?: boolean };
}

export interface HomeDay {
  id: string;
  dayIndex: number;
  title: string;
  focus: string | null;
  estimatedMinutes: number | null;
}

export interface HomeCycle {
  week: number;
  totalWeeks: number;
  phase: CyclePhase;
  label: string;
  focus: string | null;
  checkIn: boolean;
}

export interface HomeResponse {
  completeness: ProfileCompleteness;
  program: {
    id: string;
    title: string;
    /** general = plan ogólny dla każdego; personal = zaprojektowany z profilu i pomiarów. */
    kind: 'general' | 'personal';
    cycle: HomeCycle | null;
    insights: string[];
    days: HomeDay[];
  } | null;
}

export interface GeneratePlanResponse {
  programId: string;
  program: GeneratedProgram;
  nutrition: NutritionTargets | null;
}
