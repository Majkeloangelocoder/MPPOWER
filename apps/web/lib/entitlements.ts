import {
  ALL_FEATURES,
  resolveEntitlements,
  type BillingProvider,
  type FeatureKey,
  type PlanCode,
  type PlanDefinition,
  type QuotaPeriod,
  type ResolvedEntitlements,
  type SubscriptionStatus,
} from '@mp-power/core';
import { HttpError } from './http';
import { supabaseAdmin } from './supabase-admin';

let planCache: { at: number; plans: PlanDefinition[] } | null = null;

/** Plany i limity z bazy (zmieniane w panelu), z minutowym cache. */
export async function loadPlans(): Promise<PlanDefinition[]> {
  if (planCache && Date.now() - planCache.at < 60_000) return planCache.plans;
  const db = supabaseAdmin();
  const [plansRes, featuresRes] = await Promise.all([
    db.from('plans').select('code, rank').eq('is_active', true),
    db.from('plan_features').select('plan_code, feature_key, enabled, quota_limit, quota_period'),
  ]);
  if (plansRes.error) throw plansRes.error;
  if (featuresRes.error) throw featuresRes.error;

  const plans: PlanDefinition[] = (plansRes.data ?? []).map((p: { code: string; rank: number }) => ({
    code: p.code as PlanCode,
    rank: Number(p.rank),
    features: {},
  }));
  for (const f of (featuresRes.data ?? []) as Array<{ plan_code: string; feature_key: string; enabled: boolean; quota_limit: number | null; quota_period: string | null }>) {
    const plan = plans.find((p) => p.code === f.plan_code);
    if (!plan || !(ALL_FEATURES as readonly string[]).includes(f.feature_key)) continue;
    plan.features[f.feature_key as FeatureKey] = {
      enabled: f.enabled,
      quota: f.quota_limit && f.quota_period ? { limit: f.quota_limit, period: f.quota_period as QuotaPeriod } : null,
    };
  }
  planCache = { at: Date.now(), plans };
  return plans;
}

/** Przelicza uprawnienia z subskrypcji (wszystkich dostawców) i grantów; zapisuje wynik w entitlements. */
export async function recomputeEntitlements(userId: string): Promise<ResolvedEntitlements> {
  const db = supabaseAdmin();
  const [subs, grants, plans] = await Promise.all([
    db.from('subscriptions').select('provider, plan_code, status, current_period_end, past_due_since').eq('user_id', userId),
    db.from('entitlement_grants').select('plan_code, expires_at, reason').eq('user_id', userId),
    loadPlans(),
  ]);
  if (subs.error) throw subs.error;
  if (grants.error) throw grants.error;

  const resolved = resolveEntitlements({
    subscriptions: (subs.data ?? []).map((s: { provider: string; plan_code: string; status: string; current_period_end: string | null; past_due_since: string | null }) => ({
      provider: s.provider as BillingProvider,
      planCode: s.plan_code as PlanCode,
      status: s.status as SubscriptionStatus,
      currentPeriodEnd: s.current_period_end,
      pastDueSince: s.past_due_since,
    })),
    grants: (grants.data ?? []).map((g: { plan_code: string; expires_at: string | null; reason: string }) => ({
      planCode: g.plan_code as PlanCode,
      expiresAt: g.expires_at,
      reason: g.reason,
    })),
    plans,
    now: new Date(),
  });

  const { error } = await db.from('entitlements').upsert({
    user_id: userId,
    plan_code: resolved.planCode,
    features: resolved.features,
    source: resolved.source,
    valid_until: resolved.validUntil,
    in_grace_period: resolved.inGracePeriod,
    computed_at: new Date().toISOString(),
  });
  if (error) throw error;
  return resolved;
}

export async function getEntitlements(userId: string): Promise<ResolvedEntitlements> {
  const { data, error } = await supabaseAdmin()
    .from('entitlements')
    .select('plan_code, features, source, valid_until, in_grace_period')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const valid = data && (data.valid_until === null || Date.parse(data.valid_until) > Date.now());
  if (!data || !valid) return recomputeEntitlements(userId);
  return {
    planCode: data.plan_code as PlanCode,
    source: data.source,
    features: data.features,
    validUntil: data.valid_until,
    inGracePeriod: Boolean(data.in_grace_period),
  };
}

export async function requireFeature(userId: string, feature: FeatureKey): Promise<ResolvedEntitlements> {
  const e = await getEntitlements(userId);
  if (!e.features[feature]?.enabled) throw new HttpError(402, 'upgrade_required', 'Ta funkcja jest dostępna w wyższym planie.');
  return e;
}

/** Atomowe zużycie limitu planu (np. skan posiłku, wiadomość do AI Coach). */
export async function consumeQuota(userId: string, e: ResolvedEntitlements, feature: FeatureKey, now = new Date()): Promise<void> {
  const quota = e.features[feature]?.quota;
  if (!quota) return;
  const { data, error } = await supabaseAdmin().rpc('consume_quota', {
    p_user: userId,
    p_feature: feature,
    p_period_start: periodStart(quota.period, now),
    p_limit: quota.limit,
  });
  if (error) throw error;
  if (data !== true) throw new HttpError(429, 'quota_exceeded', 'Wykorzystałeś limit tej funkcji w bieżącym okresie.');
}

/** Początek okresu limitu (UTC): dzień, tydzień od poniedziałku albo miesiąc. */
export function periodStart(period: QuotaPeriod, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === 'month') d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}
