// Test dymny końca do końca na lokalnym Supabase + API (pnpm dev / next start).
// Użycie: node scripts/e2e-smoke.mjs  (zmienne: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, API_URL)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const API = process.env.API_URL ?? 'http://localhost:3000';
if (!KEY) throw new Error('Ustaw SUPABASE_PUBLISHABLE_KEY (z `npx supabase status`).');

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const email = `e2e+${Date.now()}@example.com`;
const { data: signUp, error: signUpError } = await supabase.auth.signUp({
  email,
  password: 'haslo-testowe-123',
  options: { data: { consents: { version: '2026-10', terms: true, privacy: true }, adult_confirmed: true } },
});
assert.ifError(signUpError);
assert.ok(signUp.session, 'Brak sesji po rejestracji (włączone potwierdzanie e-maila?)');
const token = signUp.session.access_token;
console.log('✓ rejestracja', email);

const { data: consents } = await supabase.from('consents').select('consent_type');
console.log('✓ zgody w bazie:', consents?.map((c) => c.consent_type).join(', '));

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const ent = await api('/api/v1/me/entitlements');
console.log('✓ plan:', ent.planCode);

const { data: days, error: daysError } = await supabase
  .from('program_days').select('id, title, day_index').order('day_index');
assert.ifError(daysError);
assert.ok(days.length > 0, 'Brak dni programu widocznych dla użytkownika');
console.log('✓ dni programu:', days.map((d) => d.title).join(', '));

async function workout(round, overshoot) {
  const clientSessionId = randomUUID();
  const player = await api('/api/v1/sessions', { programDayId: days[0].id, clientSessionId });
  const again = await api('/api/v1/sessions', { programDayId: days[0].id, clientSessionId });
  assert.equal(again.sessionId, player.sessionId, 'start nie jest idempotentny');
  const resumed = await api(`/api/v1/sessions/${player.sessionId}`);
  assert.equal(resumed.exercises.length, player.exercises.length);
  console.log(`✓ [${round}] start ${player.title}: ${player.exercises.length} ćwiczeń (idempotentny, wznawialny)`);

  const sets = player.exercises.flatMap((ex) =>
    Array.from({ length: ex.prescription.sets }, (_, i) => ({
      sessionExerciseId: ex.sessionExerciseId,
      setIndex: i + 1,
      setType: 'working',
      loadKg: ex.loadType === 'bodyweight' ? null : ex.target?.loadKg ?? 40,
      reps: overshoot ? ex.prescription.repMax : ex.target?.repsPerSet[i] ?? ex.prescription.repMin,
      rir: overshoot ? ex.prescription.targetRir + 1 : ex.prescription.targetRir,
      completed: true,
    })),
  );
  const done = await api(`/api/v1/sessions/${player.sessionId}/complete`, { sets, sessionRpe: 7 });
  const repeat = await api(`/api/v1/sessions/${player.sessionId}/complete`, { sets, sessionRpe: 7 });
  assert.equal(repeat.alreadyCompleted, true, 'ponowne zakończenie nie jest idempotentne');
  console.log(`✓ [${round}] koniec: ocena ${done.score}, rekordy ${done.records.length}, źródło tekstu: ${done.review.source}`);
  console.log(`    „${done.review.headline}” — ${done.review.summary}`);
  for (const t of done.nextTargets.slice(0, 3)) {
    console.log(`    → ${t.exerciseName}: ${t.action} ${t.next.loadKg ?? '-'} kg × ${t.next.repsPerSet.join('/')} — ${t.explanation}`);
  }
  return { player, done };
}

const first = await workout(1, true);
const second = await workout(2, false);
const withTarget = second.player.exercises.filter((e) => e.target);
assert.ok(withTarget.length > 0, 'drugi trening nie dostał celów z silnika progresji');
console.log(`✓ drugi trening: ${withTarget.length}/${second.player.exercises.length} ćwiczeń ma cel z poprzedniej rekomendacji`);
const e0 = first.player.exercises[0];
console.log(`    np. ${e0.name}: cel ${withTarget[0].target.loadKg ?? '-'} kg × ${withTarget[0].target.repsPerSet.join('/')}; dlaczego: ${withTarget[0].why}`);

// Bezpieczeństwo: obcy użytkownik nie widzi cudzej sesji.
const other = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const { data: o } = await other.auth.signUp({
  email: `e2e+other${Date.now()}@example.com`, password: 'haslo-testowe-123',
  options: { data: { consents: { version: '2026-10', terms: true, privacy: true } } },
});
const res = await fetch(`${API}/api/v1/sessions/${first.player.sessionId}`, { headers: { authorization: `Bearer ${o.session.access_token}` } });
assert.ok(res.status === 404 || res.status === 403, `obcy użytkownik dostał ${res.status}`);
const { data: leaked } = await other.from('workout_sessions').select('id');
assert.equal(leaked.length, 0, 'RLS: obcy widzi cudze sesje');
console.log(`✓ obcy użytkownik: API ${res.status}, RLS 0 wierszy`);
console.log('\nWSZYSTKO OK');
