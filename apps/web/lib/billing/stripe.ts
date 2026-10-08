import Stripe from 'stripe';
import { env } from '../env';

let client: Stripe | null = null;

/** Klient Stripe z wersją API przypiętą przez zainstalowany pakiet. */
export function stripe(): Stripe {
  client ??= new Stripe(env.stripeSecretKey());
  return client;
}
