import { PROGRAM_DAYS } from './server';
import { readState, writeState } from './store';

/**
 * Zamiennik src/lib/supabase.ts w trybie demo: logowanie bez serwera (dowolny e-mail i hasło)
 * i tabela program_days z danymi z seed.sql. Udostępnia tylko to, czego używają ekrany.
 */

interface DemoSession { access_token: string; user: { id: string; email: string } }
type Listener = (event: string, session: DemoSession | null) => void;

let session: DemoSession | null = readState<DemoSession | null>('session', null);
const listeners = new Set<Listener>();

function setSession(next: DemoSession | null, event: string) {
  session = next;
  writeState('session', next);
  for (const l of listeners) l(event, next);
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 300));

function signIn(email: string) {
  setSession({ access_token: 'demo', user: { id: 'demo-user', email } }, 'SIGNED_IN');
  return { data: { session, user: session!.user }, error: null };
}

export const supabase = {
  auth: {
    async getSession() {
      return { data: { session }, error: null };
    },
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      await delay();
      return signIn(email);
    },
    async signUp({ email }: { email: string; password: string; options?: unknown }) {
      await delay();
      return signIn(email);
    },
    async signOut() {
      setSession(null, 'SIGNED_OUT');
      return { error: null };
    },
    startAutoRefresh() {},
    stopAutoRefresh() {},
  },
  from(table: string) {
    const rows = table === 'program_days' ? PROGRAM_DAYS : [];
    const result = Promise.resolve({ data: structuredClone(rows), error: null });
    const query = { select: () => query, order: () => result };
    return query;
  },
};
