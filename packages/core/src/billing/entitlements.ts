/**
 * Rozstrzyganie uprawnień (entitlements) po stronie serwera.
 * Frontend nigdy o nich nie decyduje — tylko wyświetla wynik tej funkcji.
 */

export type PlanCode = 'free' | 'pro' | 'premium';
export type FeatureKey =
  | 'exercise_library_full'
  | 'program_generator'
  | 'progression_advanced'
  | 'ai_session_review'
  | 'ai_coach'
  | 'nutrition_targets'
  | 'food_scanner'
  | 'advanced_stats'
  | 'weekly_review'
  | 'progress_photos'
  | 'body_scan'
  | 'technique_analysis';

export const ALL_FEATURES: readonly FeatureKey[] = [
  'exercise_library_full',
  'program_generator',
  'progression_advanced',
  'ai_session_review',
  'ai_coach',
  'nutrition_targets',
  'food_scanner',
  'advanced_stats',
  'weekly_review',
  'progress_photos',
  'body_scan',
  'technique_analysis',
];

export type QuotaPeriod = 'day' | 'week' | 'month';

export interface FeatureGrant {
  enabled: boolean;
  quota: { limit: number; period: QuotaPeriod } | null;
}

export interface PlanDefinition {
  code: PlanCode;
  rank: number;
  features: Partial<Record<FeatureKey, FeatureGrant>>;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type BillingProvider = 'stripe' | 'app_store' | 'play_store' | 'manual';

export interface SubscriptionSnapshot {
  provider: BillingProvider;
  planCode: PlanCode;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  pastDueSince?: string | null;
}

export interface ManualGrant {
  planCode: PlanCode;
  expiresAt: string | null;
  reason: string;
}

export interface ResolvedEntitlements {
  planCode: PlanCode;
  source: BillingProvider | 'grant' | 'default';
  features: Record<FeatureKey, FeatureGrant>;
  validUntil: string | null;
  inGracePeriod: boolean;
}

export const DEFAULT_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

const on = (limit?: number, period?: QuotaPeriod): FeatureGrant => ({
  enabled: true,
  quota: limit !== undefined && period !== undefined ? { limit, period } : null,
});

/** Startowe definicje planów — źródłem prawdy w produkcji jest tabela plan_features (panel admina). */
export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  { code: 'free', rank: 0, features: { ai_coach: on(5, 'week') } },
  {
    code: 'pro',
    rank: 1,
    features: {
      exercise_library_full: on(),
      program_generator: on(),
      progression_advanced: on(),
      ai_session_review: on(),
      ai_coach: on(50, 'day'),
      nutrition_targets: on(),
      food_scanner: on(10, 'day'),
      advanced_stats: on(),
      weekly_review: on(),
      progress_photos: on(),
    },
  },
  {
    code: 'premium',
    rank: 2,
    features: {
      exercise_library_full: on(),
      program_generator: on(),
      progression_advanced: on(),
      ai_session_review: on(),
      ai_coach: on(150, 'day'),
      nutrition_targets: on(),
      food_scanner: on(25, 'day'),
      advanced_stats: on(),
      weekly_review: on(),
      progress_photos: on(),
      body_scan: on(4, 'month'),
      technique_analysis: on(20, 'month'),
    },
  },
];

interface Candidate {
  plan: PlanDefinition;
  source: ResolvedEntitlements['source'];
  validUntilMs: number | null;
  inGrace: boolean;
}

export function resolveEntitlements(args: {
  subscriptions: readonly SubscriptionSnapshot[];
  grants?: readonly ManualGrant[];
  plans?: readonly PlanDefinition[];
  now: Date;
  graceDays?: number;
}): ResolvedEntitlements {
  const plans = args.plans ?? DEFAULT_PLANS;
  const nowMs = args.now.getTime();
  const graceMs = (args.graceDays ?? DEFAULT_GRACE_DAYS) * DAY_MS;
  const byCode = new Map(plans.map((p) => [p.code, p]));
  const candidates: Candidate[] = [];

  for (const sub of args.subscriptions) {
    const plan = byCode.get(sub.planCode);
    if (!plan) continue;
    const endMs = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : null;
    if ((sub.status === 'active' || sub.status === 'trialing') && endMs !== null && endMs > nowMs) {
      candidates.push({ plan, source: sub.provider, validUntilMs: endMs, inGrace: false });
    } else if (sub.status === 'past_due') {
      const sinceIso = sub.pastDueSince ?? sub.currentPeriodEnd;
      const sinceMs = sinceIso ? Date.parse(sinceIso) : null;
      if (sinceMs !== null && nowMs < sinceMs + graceMs) {
        candidates.push({ plan, source: sub.provider, validUntilMs: sinceMs + graceMs, inGrace: true });
      }
    }
  }

  for (const grant of args.grants ?? []) {
    const plan = byCode.get(grant.planCode);
    if (!plan) continue;
    const expiresMs = grant.expiresAt ? Date.parse(grant.expiresAt) : null;
    if (expiresMs === null || expiresMs > nowMs) {
      candidates.push({ plan, source: 'grant', validUntilMs: expiresMs, inGrace: false });
    }
  }

  candidates.sort((a, b) => {
    if (b.plan.rank !== a.plan.rank) return b.plan.rank - a.plan.rank;
    if (a.inGrace !== b.inGrace) return a.inGrace ? 1 : -1;
    return (b.validUntilMs ?? Infinity) - (a.validUntilMs ?? Infinity);
  });

  const winner = candidates[0];
  const fallback = [...plans].sort((a, b) => a.rank - b.rank)[0];
  const plan = winner?.plan ?? fallback;
  if (!plan) throw new Error('No plan definitions configured');

  const features = {} as Record<FeatureKey, FeatureGrant>;
  for (const key of ALL_FEATURES) features[key] = plan.features[key] ?? { enabled: false, quota: null };

  return {
    planCode: plan.code,
    source: winner?.source ?? 'default',
    features,
    validUntil: winner?.validUntilMs != null ? new Date(winner.validUntilMs).toISOString() : null,
    inGracePeriod: winner?.inGrace ?? false,
  };
}

export function hasFeature(e: ResolvedEntitlements, key: FeatureKey): boolean {
  return e.features[key].enabled;
}
