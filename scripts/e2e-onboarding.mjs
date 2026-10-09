// Test końca do końca: ankieta startowa → pomiary → zdjęcia → plan na 8 tygodni → tydzień cyklu w treningu.
// Użycie: node scripts/e2e-onboarding.mjs (SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY; API_URL domyślnie localhost:3000)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const API = process.env.API_URL ?? 'http://localhost:3000';
const { SUPABASE_PUBLISHABLE_KEY: KEY, SUPABASE_SECRET_KEY: SECRET } = process.env;
if (!KEY || !SECRET) throw new Error('Ustaw SUPABASE_PUBLISHABLE_KEY i SUPABASE_SECRET_KEY (z `npx supabase status`).');

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const admin = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
const { data: signUp, error } = await supabase.auth.signUp({
  email: `onb+${Date.now()}@example.com`,
  password: 'haslo-testowe-123',
  options: { data: { consents: { version: '2026-10', terms: true, privacy: true } } },
});
assert.ifError(error);
const token = signUp.session.access_token;
const userId = signUp.user.id;

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

// 1. Zaraz po rejestracji: plan ogólny, profil pusty.
let home = await ok('GET', '/api/v1/me/home');
assert.equal(home.program.kind, 'general');
assert.equal(home.completeness.complete, false);
console.log(`✓ po rejestracji: plan ogólny „${home.program.title}” (${home.program.days.length} dni), profil ${home.completeness.percent}%`);
assert.equal((await call('POST', '/api/v1/programs/generate')).status, 409);
console.log('✓ bez profilu i pomiarów plan na cykl jest zablokowany (409)');

// 2. Ankieta krok po kroku.
await ok('PUT', '/api/v1/me/profile', { goal: 'fat_loss', level: 'beginner' });
await ok('PUT', '/api/v1/me/profile', { sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 79.5 });
const noConsent = await call('PUT', '/api/v1/me/profile', { daysPerWeek: 3, sessionMinutes: 45, location: 'gym', limitations: ['knee'] });
assert.equal(noConsent.status, 403);
console.log('✓ kontuzje bez zgody na dane o zdrowiu → 403');
await ok('PUT', '/api/v1/me/profile', { daysPerWeek: 3, sessionMinutes: 45, location: 'gym', limitations: ['knee'], consents: { healthData: true } });
const invalid = await call('PUT', '/api/v1/me/profile', { circumferences: { waist: 860 } });
assert.equal(invalid.status, 400);
let profile = await ok('PUT', '/api/v1/me/profile', { circumferences: { waist: 88, abdomen: 95, chest: 98, arm: 31, thigh: 60, hips: 104 } });
assert.equal(profile.completeness.complete, true);
assert.deepEqual(profile.profile.limitations, ['knee']);
console.log(`✓ ankieta i obwody zapisane, profil ${profile.completeness.percent}%; literówka w obwodzie → 400`);

// Ponowny zapis tych samych obwodów nie dubluje historii pomiarów.
await ok('PUT', '/api/v1/me/profile', { circumferences: { waist: 88 } });
const { count } = await admin.from('measurements').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'waist');
assert.equal(count, 1);

// 3. Zdjęcia sylwetki: bez zgody RLS blokuje, ze zgodą — plik w prywatnym kubełku + podpisany adres.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const userDb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${token}` } } });
const path = `${userId}/${randomUUID()}.png`;
const denied = await userDb.storage.from('body-photos').upload(path, png, { contentType: 'image/png' });
assert.ok(denied.error, 'upload bez zgody powinien być zablokowany');
await ok('PUT', '/api/v1/me/profile', { consents: { bodyImages: true } });
const up = await userDb.storage.from('body-photos').upload(path, png, { contentType: 'image/png' });
assert.ifError(up.error);
const ins = await userDb.from('progress_photos').insert({ user_id: userId, pose: 'front', storage_path: path });
assert.ifError(ins.error);
profile = await ok('GET', '/api/v1/me/profile');
assert.equal(profile.photos.length, 1);
assert.equal((await fetch(profile.photos[0].url)).status, 200);
console.log('✓ zdjęcie: bez zgody zablokowane, ze zgodą zapisane i dostępne przez podpisany adres');

// 4. Projekt planu na 8 tygodni.
const generated = await ok('POST', '/api/v1/programs/generate');
assert.equal(generated.program.cycleWeeks, 8);
assert.equal(generated.program.days.length, 3);
console.log(`✓ plan: ${generated.program.title}; dni: ${generated.program.days.map((d) => d.title).join(', ')}; ${generated.nutrition.caloriesKcal} kcal, białko ${generated.nutrition.proteinG} g`);
generated.program.insights.forEach((i) => console.log(`    • ${i}`));
const kneeTags = await admin.from('exercises').select('id').contains('stress_tags', ['knee_deep_flexion']);
const kneeIds = new Set(kneeTags.data.map((e) => e.id));
assert.ok(generated.program.days.every((d) => d.exercises.every((e) => !kneeIds.has(e.exerciseId))), 'plan obciąża kolano');

home = await ok('GET', '/api/v1/me/home');
assert.equal(home.program.kind, 'personal');
assert.deepEqual([home.program.cycle.week, home.program.cycle.phase], [1, 'intro']);
console.log(`✓ ekran Dziś: „${home.program.title}”, tydzień ${home.program.cycle.week}/${home.program.cycle.totalWeeks} · ${home.program.cycle.label}`);

// 5. Trening w tygodniu 1: o jedną serię mniej w głównych ćwiczeniach.
async function workout(label) {
  const day = home.program.days[0];
  const player = await ok('POST', '/api/v1/sessions', { programDayId: day.id, clientSessionId: randomUUID() });
  const sets = player.exercises.flatMap((ex) =>
    Array.from({ length: ex.target?.sets ?? ex.prescription.sets }, (_, i) => ({
      sessionExerciseId: ex.sessionExerciseId, setIndex: i + 1,
      loadKg: ex.loadType === 'external' ? ex.target?.loadKg ?? 30 : null,
      reps: ex.prescription.repMax, rir: ex.prescription.targetRir, completed: true,
    })),
  );
  const done = await ok('POST', `/api/v1/sessions/${player.sessionId}/complete`, { sets });
  console.log(`✓ [${label}] tydzień ${player.cycle.week} (${player.cycle.label}): ${player.exercises.map((e) => `${e.name} ${e.prescription.sets}×${e.prescription.repMin}–${e.prescription.repMax} RIR ${e.prescription.targetRir}`).join('; ')} → ocena ${done.score}, nowe cele: ${done.nextTargets.length}`);
  return { player, done };
}
const w1 = await workout('tydz. 1');
const plannedMain = generated.program.days[0].exercises.find((e) => e.block === 'main');
const w1Main = w1.player.exercises.find((e) => e.exerciseId === plannedMain.exerciseId);
assert.equal(w1Main.prescription.sets, plannedMain.sets - 1);
assert.ok(w1.done.nextTargets.length > 0);

// 6. Tydzień 4 (odciążenie): przesuwamy start cyklu o 3 tygodnie wstecz.
await admin.from('user_programs').update({ started_at: new Date(Date.now() - 22 * 86_400_000).toISOString() }).eq('user_id', userId).eq('status', 'active');
home = await ok('GET', '/api/v1/me/home');
assert.deepEqual([home.program.cycle.week, home.program.cycle.phase, home.program.cycle.checkIn], [4, 'deload', true]);
const w4 = await workout('tydz. 4');
const w4Main = w4.player.exercises.find((e) => e.exerciseId === plannedMain.exerciseId);
assert.equal(w4Main.prescription.sets, Math.round(plannedMain.sets * 0.6));
assert.equal(w4Main.target.sets, w4Main.prescription.sets, 'cel dopasowany do serii tygodnia');
assert.equal(w4.done.nextTargets.length, 0, 'odciążenie nie zmienia celów');
console.log('✓ odciążenie: 60% serii, cele z tygodnia 1 zachowane, przypomnienie o pomiarach');

// 7. Ponowne projektowanie zastępuje aktywny plan (jeden aktywny).
await ok('PUT', '/api/v1/me/profile', { goal: 'muscle_gain', daysPerWeek: 4 });
const again = await ok('POST', '/api/v1/programs/generate');
const { data: active } = await admin.from('user_programs').select('program_id').eq('user_id', userId).eq('status', 'active');
assert.deepEqual(active.map((a) => a.program_id), [again.programId]);
console.log(`✓ zmiana celu → nowy plan „${again.program.title}” (${again.program.days.map((d) => d.title).join(', ')}), poprzedni zakończony`);
console.log('\nWSZYSTKO OK');
