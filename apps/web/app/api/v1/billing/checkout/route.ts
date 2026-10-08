import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { stripe } from '@/lib/billing/stripe';
import { ensureStripeCustomer } from '@/lib/billing/sync';
import { env } from '@/lib/env';
import { HttpError, handle, json, readJson } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

const Body = z.object({
  planCode: z.enum(['pro', 'premium']),
  interval: z.enum(['month', 'year']),
  promotionCode: z.string().trim().max(64).optional(),
});

/** Zakup na web (mppowerfit.pl): Stripe Checkout z trialem i kodami promocyjnymi. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const body = Body.parse(await readJson(req));

    const { data: price, error } = await supabaseAdmin()
      .from('prices')
      .select('provider_price_id, trial_days')
      .eq('provider', 'stripe')
      .eq('plan_code', body.planCode)
      .eq('billing_interval', body.interval)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!price) throw new HttpError(404, 'price_not_found', 'Ten plan nie jest jeszcze dostępny.');

    const customer = await ensureStripeCustomer(userId);
    let discounts: Array<{ promotion_code: string }> | undefined;
    if (body.promotionCode) {
      const found = await stripe().promotionCodes.list({ code: body.promotionCode, active: true, limit: 1 });
      const promo = found.data[0];
      if (!promo) throw new HttpError(400, 'invalid_promotion_code', 'Kod rabatowy jest nieprawidłowy albo wygasł.');
      discounts = [{ promotion_code: promo.id }];
    }

    const automaticTax = env.optional('STRIPE_AUTOMATIC_TAX') === 'true';
    const appUrl = env.appUrl();
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: userId,
      line_items: [{ price: price.provider_price_id, quantity: 1 }],
      subscription_data: {
        metadata: { user_id: userId },
        ...(price.trial_days > 0 ? { trial_period_days: price.trial_days } : {}),
      },
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
      ...(automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const, name: 'auto' as const } } : {}),
      locale: 'pl',
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
    });
    if (!session.url) throw new HttpError(502, 'checkout_unavailable', 'Płatności są chwilowo niedostępne.');
    return json({ url: session.url });
  });
}
