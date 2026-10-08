import type Stripe from 'stripe';
import type { PlanCode, SubscriptionStatus } from '@mp-power/core';
import { recomputeEntitlements } from '../entitlements';
import { supabaseAdmin } from '../supabase-admin';
import { stripe } from './stripe';

/** Identyfikator z pola, które Stripe zwraca jako string albo rozwinięty obiekt. */
export function idOf(ref: unknown): string | null {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && 'id' in ref && typeof (ref as { id: unknown }).id === 'string') return (ref as { id: string }).id;
  return null;
}

/** Pole liczbowe niezależne od wersji API (np. okres rozliczeniowy przeniesiony na pozycję subskrypcji). */
function unixField(obj: unknown, key: string): number | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  }
  return null;
}

const toIso = (unix: number | null): string | null => (unix === null ? null : new Date(unix * 1000).toISOString());

export async function linkCustomer(userId: string, customerId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('billing_customers')
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function userIdForCustomer(customerId: string, metadataUserId?: string | null): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (data?.user_id) return data.user_id as string;
  if (metadataUserId) {
    await linkCustomer(metadataUserId, customerId);
    return metadataUserId;
  }
  return null;
}

/** Klient Stripe dla użytkownika — tworzony przy pierwszym checkout, z user_id w metadanych. */
export async function ensureStripeCustomer(userId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  const { data: auth } = await db.auth.admin.getUserById(userId);
  const customer = await stripe().customers.create({
    email: auth?.user?.email ?? undefined,
    metadata: { user_id: userId },
  });
  await linkCustomer(userId, customer.id);
  return customer.id;
}

async function planForPrice(priceId: string | null): Promise<PlanCode> {
  if (!priceId) throw new Error('Subscription without price');
  const { data, error } = await supabaseAdmin()
    .from('prices')
    .select('plan_code')
    .eq('provider', 'stripe')
    .eq('provider_price_id', priceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Nieznana cena Stripe ${priceId} — dodaj ją w panelu (tabela prices).`);
  return data.plan_code as PlanCode;
}

/**
 * Źródłem prawdy jest aktualny stan subskrypcji pobrany ze Stripe, nie treść zdarzenia —
 * dzięki temu kolejność webhooków nie ma znaczenia.
 */
export async function syncStripeSubscription(subscriptionId: string): Promise<string | null> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = idOf(sub.customer);
  if (!customerId) throw new Error('Subscription without customer');
  const userId = await userIdForCustomer(customerId, sub.metadata?.user_id ?? null);
  if (!userId) {
    console.warn('[billing] subskrypcja nieznanego klienta', customerId);
    return null;
  }

  const item = sub.items?.data?.[0];
  const priceId: string | null = item?.price?.id ?? null;
  const planCode = await planForPrice(priceId);
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('subscriptions')
    .select('past_due_since')
    .eq('provider', 'stripe')
    .eq('provider_subscription_id', sub.id)
    .maybeSingle();
  const status = sub.status as SubscriptionStatus;

  const { error } = await db.from('subscriptions').upsert(
    {
      user_id: userId,
      provider: 'stripe',
      provider_subscription_id: sub.id,
      plan_code: planCode,
      provider_price_id: priceId,
      status,
      current_period_start: toIso(unixField(item, 'current_period_start') ?? unixField(sub, 'current_period_start')),
      current_period_end: toIso(unixField(item, 'current_period_end') ?? unixField(sub, 'current_period_end')),
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      trial_end: toIso(unixField(sub, 'trial_end')),
      canceled_at: toIso(unixField(sub, 'canceled_at')),
      past_due_since: status === 'past_due' ? existing?.past_due_since ?? new Date().toISOString() : null,
    },
    { onConflict: 'provider,provider_subscription_id' },
  );
  if (error) throw error;
  await recomputeEntitlements(userId);
  return userId;
}

export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } | null } | null;
    subscription?: unknown;
  };
  return idOf(raw.parent?.subscription_details?.subscription ?? raw.subscription ?? null);
}

export async function recordInvoice(invoice: Stripe.Invoice, status: 'paid' | 'failed'): Promise<void> {
  const customerId = idOf(invoice.customer);
  const userId = customerId ? await userIdForCustomer(customerId) : null;
  const { error } = await supabaseAdmin().from('payments').upsert(
    {
      user_id: userId,
      provider: 'stripe',
      provider_payment_id: invoice.id,
      amount: status === 'paid' ? invoice.amount_paid : invoice.amount_due,
      currency: invoice.currency,
      status,
      invoice_url: invoice.hosted_invoice_url ?? null,
      occurred_at: new Date().toISOString(),
    },
    { onConflict: 'provider,provider_payment_id' },
  );
  if (error) throw error;
}
