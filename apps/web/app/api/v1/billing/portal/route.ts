import { requireUser } from '@/lib/auth';
import { stripe } from '@/lib/billing/stripe';
import { env } from '@/lib/env';
import { HttpError, handle, json } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

/** Stripe Customer Portal: zmiana planu, karty, faktury, anulowanie — dla zakupów z web. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const { userId } = await requireUser(req);
    const { data, error } = await supabaseAdmin()
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) {
      throw new HttpError(404, 'no_billing_account', 'Nie masz subskrypcji kupionej przez stronę. Zakupami w aplikacji zarządzasz w ustawieniach sklepu.');
    }
    const session = await stripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${env.appUrl()}/account`,
      locale: 'pl',
    });
    return json({ url: session.url });
  });
}
