import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let admin: SupabaseClient | null = null;

/**
 * Klient z kluczem serwisowym — omija RLS. Używany wyłącznie w kodzie serwera
 * i zawsze z jawnym filtrem user_id w zapytaniach.
 */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
