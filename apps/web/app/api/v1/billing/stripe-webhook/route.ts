import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { idOf, linkCustomer, recordInvoice, subscriptionIdFromInvoice, syncStripeSubscription } from '@/lib/billing/sync';
import { env } from '@/lib/env';
import { json } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

/**
 * Webhook Stripe: weryfikacja podpisu na surowej treści → zapis zdarzenia (idempotencja)
 * → synchronizacja subskrypcji i uprawnień. Błąd zwraca 500, więc Stripe ponowi wysyłkę.
 */
export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: { code: 'missing_signature' } }, 400);
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, env.stripeWebhookSecret());
  } catch {
    return json({ error: { code: 'invalid_signature' } }, 400);
  }

  const db = supabaseAdmin();
  const { error: insertError } = await db
    .from('billing_events')
    .insert({ provider: 'stripe', event_id: event.id, event_type: event.type, payload: event });
  if (insertError && insertError.code !== '23505') return json({ error: { code: 'storage_failed' } }, 500);
  if (insertError) {
    const { data } = await db.from('billing_events').select('processed_at').eq('provider', 'stripe').eq('event_id', event.id).maybeSingle();
    if (data?.processed_at) return json({ received: true, duplicate: true });
  }

  try {
    await processEvent(event);
    await db
      .from('billing_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
    return json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook]', event.type, err);
    await db
      .from('billing_events')
      .update({ error: err instanceof Error ? err.message : String(err) })
      .eq('provider', 'stripe')
      .eq('event_id', event.id);
    return json({ error: { code: 'processing_failed' } }, 500);
  }
}

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = idOf(session.customer);
      const subscriptionId = idOf(session.subscription);
      if (session.mode === 'subscription' && customerId && session.client_reference_id) {
        await linkCustomer(session.client_reference_id, customerId);
      }
      if (subscriptionId) await syncStripeSubscription(subscriptionId);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const sub = event.data.object as Stripe.Subscription;
      await syncStripeSubscription(sub.id);
      return;
    }
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await syncStripeSubscription(sub.id);
      if (userId) {
        await supabaseAdmin().from('notifications').upsert(
          {
            user_id: userId,
            category: 'billing',
            title: 'Twój okres próbny kończy się za 3 dni',
            body: 'Sprawdź plan, żeby zachować dostęp do funkcji PRO.',
            dedupe_key: `trial_will_end:${sub.id}`,
          },
          { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
        );
      }
      return;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await recordInvoice(invoice, event.type === 'invoice.paid' ? 'paid' : 'failed');
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (subscriptionId) await syncStripeSubscription(subscriptionId);
      return;
    }
    default:
      // Pozostałe zdarzenia są zapisane w billing_events, ale nie zmieniają uprawnień.
      return;
  }
}
