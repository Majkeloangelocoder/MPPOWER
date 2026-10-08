function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

/** Odczyt przy użyciu (a nie przy imporcie) — brak klucza Stripe nie blokuje np. endpointów treningu. */
export const env = {
  supabaseUrl: () => required('SUPABASE_URL'),
  supabaseSecretKey: () => required('SUPABASE_SECRET_KEY'),
  stripeSecretKey: () => required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
  appUrl: () => required('APP_URL'),
  optional: (name: string): string | undefined => process.env[name] || undefined,
};
