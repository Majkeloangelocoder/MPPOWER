import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWeek, buildCycleWeeks, currentCycleWeek, fitTargetToSets } from './cycle.ts';
import { generateCyclePlan, ProfileIncompleteError } from './generator.ts';
import { profileCompleteness, waistToHeightRatio } from './profile.ts';
import { STARTER_LIBRARY } from './starter-library.ts';
import type { OnboardingProfile } from './types.ts';

const NOW = new Date('2026-10-09T10:00:00Z');
const base: OnboardingProfile = {
  goal: 'muscle_gain',
  level: 'intermediate',
  sex: 'male',
  birthYear: 1994,
  heightCm: 180,
  weightKg: 82,
  daysPerWeek: 3,
  sessionMinutes: 60,
  location: 'gym',
  limitations: [],
  circumferences: { waist: 84, abdomen: 88, chest: 102, arm: 35, thigh: 57 },
};
const byId = new Map(STARTER_LIBRARY.map((e) => [e.id, e]));
const allExercises = (p: OnboardingProfile) => generateCyclePlan(p, STARTER_LIBRARY, NOW).program.days.flatMap((d) => d.exercises);

describe('profil startowy', () => {
  it('pusty profil: brak wszystkich pól, 0%', () => {
    const c = profileCompleteness({}, NOW);
    assert.equal(c.complete, false);
    assert.equal(c.percent, 0);
    assert.ok(c.missing.includes('circumference.abdomen'));
  });

  it('komplet danych i obwodów → można projektować plan', () => {
    assert.deepEqual(profileCompleteness(base, NOW), { complete: true, missing: [], percent: 100 });
  });

  it('bez pomiarów obwodów nie ma planu na cykl', () => {
    const c = profileCompleteness({ ...base, circumferences: { waist: 84 } }, NOW);
    assert.equal(c.complete, false);
    assert.deepEqual(c.missing, ['circumference.abdomen', 'circumference.chest', 'circumference.arm', 'circumference.thigh']);
    assert.throws(() => generateCyclePlan({ ...base, circumferences: {} }, STARTER_LIBRARY, NOW), ProfileIncompleteError);
  });

  it('literówki i niepełnoletność są odrzucane', () => {
    const c = profileCompleteness({ ...base, heightCm: 1800, birthYear: 2012, circumferences: { ...base.circumferences, waist: 840 } }, NOW);
    assert.deepEqual(c.missing, ['birthYear', 'heightCm', 'circumference.waist']);
  });

  it('trening w domu wymaga informacji o sprzęcie', () => {
    assert.ok(profileCompleteness({ ...base, location: 'home' }, NOW).missing.includes('location'));
  });

  it('stosunek talii do wzrostu', () => {
    assert.equal(waistToHeightRatio(90, 180), 0.5);
  });
});

describe('generator planu na 8 tygodni', () => {
  it('3 dni na siłowni → Full Body A/B/C, 8 tygodni, cele kaloryczne', () => {
    const { program, nutrition } = generateCyclePlan(base, STARTER_LIBRARY, NOW);
    assert.equal(program.cycleWeeks, 8);
    assert.equal(program.weeks.length, 8);
    assert.deepEqual(program.days.map((d) => d.title), ['Full Body A', 'Full Body B', 'Full Body C']);
    for (const day of program.days) {
      assert.ok(day.exercises.length >= 5 && day.exercises.length <= 6, `${day.title}: ${day.exercises.length}`);
      assert.equal(new Set(day.exercises.map((e) => e.exerciseId)).size, day.exercises.length, 'powtórzone ćwiczenie w dniu');
    }
    assert.ok(nutrition && nutrition.caloriesKcal > nutrition.tdeeKcal, 'budowa mięśni = nadwyżka');
  });

  it('jest deterministyczny', () => {
    assert.deepEqual(generateCyclePlan(base, STARTER_LIBRARY, NOW), generateCyclePlan(base, STARTER_LIBRARY, NOW));
  });

  it('liczba dni wybiera podział: 2 FBW, 4 góra/dół, 6 push/pull/nogi', () => {
    const titles = (d: number) => generateCyclePlan({ ...base, daysPerWeek: d }, STARTER_LIBRARY, NOW).program.days.map((x) => x.title);
    assert.deepEqual(titles(2), ['Full Body A', 'Full Body B']);
    assert.deepEqual(titles(4), ['Góra A', 'Dół A', 'Góra B', 'Dół B']);
    assert.equal(titles(6).length, 6);
  });

  it('cel zmienia zakres powtórzeń: siła 4–6, budowa mięśni 6–10', () => {
    const main = (goal: OnboardingProfile['goal']) => allExercises({ ...base, goal }).find((e) => e.block === 'main' && byId.get(e.exerciseId)!.loadType === 'external')!;
    assert.deepEqual([main('strength').repMin, main('strength').repMax, main('strength').restSeconds], [4, 6, 180]);
    assert.deepEqual([main('muscle_gain').repMin, main('muscle_gain').repMax], [6, 10]);
  });

  it('dom bez sprzętu → tylko masa ciała; zastępstwo za przyciąganie pionowe opisane', () => {
    const p = { ...base, location: 'home' as const, homeEquipment: 'none' as const };
    for (const e of allExercises(p)) {
      const lib = byId.get(e.exerciseId)!;
      assert.ok(lib.equipment.every((q) => ['bodyweight', 'mat', 'box'].includes(q)), `${lib.name}: ${lib.equipment}`);
    }
    assert.ok(generateCyclePlan(p, STARTER_LIBRARY, NOW).program.insights.some((i) => i.includes('drążka')));
  });

  it('ograniczenie kolana usuwa głębokie zgięcie kolana; bark — wyciskanie nad głowę', () => {
    const exercises = allExercises({ ...base, limitations: ['knee', 'shoulder'] });
    for (const e of exercises) {
      const tags = byId.get(e.exerciseId)!.stressTags;
      assert.ok(!tags.includes('knee_deep_flexion') && !tags.includes('shoulder_overhead'), byId.get(e.exerciseId)!.name);
    }
  });

  it('początkujący: proste ćwiczenia i większy zapas', () => {
    const exercises = allExercises({ ...base, level: 'beginner' });
    assert.ok(exercises.every((e) => byId.get(e.exerciseId)!.difficulty <= 2));
    const main = exercises.find((e) => e.block === 'main')!;
    assert.equal(main.sets, 3);
    assert.equal(main.targetRir, 3);
  });

  it('talia ≥ 0,5 wzrostu → finiszer kondycyjny nawet przy budowie mięśni', () => {
    const lean = allExercises(base);
    assert.ok(!lean.some((e) => e.block === 'finisher'));
    const p = { ...base, circumferences: { ...base.circumferences, waist: 98 } };
    assert.ok(allExercises(p).some((e) => e.block === 'finisher'));
    assert.ok(generateCyclePlan(p, STARTER_LIBRARY, NOW).program.insights.some((i) => i.includes('0,54')));
  });

  it('siła na siłowni: główne ćwiczenia z obciążeniem', () => {
    for (const e of allExercises({ ...base, goal: 'strength', level: 'advanced', daysPerWeek: 6 }).filter((x) => x.block === 'main')) {
      assert.equal(byId.get(e.exerciseId)!.loadType, 'external', byId.get(e.exerciseId)!.name);
    }
  });

  it('dom bez sprzętu: każdy dzień ma pełną sesję mimo braku drążka i hantli', () => {
    const { days } = generateCyclePlan({ ...base, goal: 'fitness', level: 'beginner', daysPerWeek: 2, sessionMinutes: 45, location: 'home', homeEquipment: 'none' }, STARTER_LIBRARY, NOW).program;
    for (const d of days) assert.equal(d.exercises.length, 5, d.title);
  });

  it('krótsza sesja = mniej ćwiczeń', () => {
    const counts = generateCyclePlan({ ...base, sessionMinutes: 30 }, STARTER_LIBRARY, NOW).program.days.map((d) => d.exercises.length);
    assert.ok(counts.every((c) => c <= 4));
  });

  it('recepty mieszczą się w ograniczeniach bazy (program_exercises)', () => {
    for (const goal of ['fat_loss', 'muscle_gain', 'strength', 'fitness'] as const) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
        for (const e of allExercises({ ...base, goal, level, daysPerWeek: 5 })) {
          assert.ok(e.sets >= 1 && e.sets <= 10 && e.repMax >= e.repMin && e.targetRir >= 0 && e.targetRir <= 5);
          assert.ok(e.tempo === null || /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/.test(e.tempo));
        }
      }
    }
  });
});

describe('periodyzacja cyklu', () => {
  const weeks = buildCycleWeeks('muscle_gain', 'intermediate');
  const main = { sets: 3, targetRir: 2, block: 'main' as const };

  it('fazy: wprowadzenie, budowanie, odciążenie w tyg. 4 i 8, szczyt w tyg. 7', () => {
    assert.deepEqual(weeks.map((w) => w.phase), ['intro', 'build', 'build', 'deload', 'build', 'build', 'peak', 'deload']);
    assert.deepEqual(weeks.filter((w) => w.checkIn).map((w) => w.weekIndex), [4, 8]);
  });

  it('recepta tygodnia: wprowadzenie −1 seria, odciążenie 60% serii, szczyt mniejszy zapas', () => {
    assert.deepEqual(applyWeek(main, weeks[0]), { ...main, sets: 2, targetRir: 3 });
    assert.deepEqual(applyWeek(main, weeks[3]), { ...main, sets: 2, targetRir: 4 });
    assert.deepEqual(applyWeek(main, weeks[6]), { ...main, sets: 4, targetRir: 1 });
    assert.deepEqual(applyWeek({ ...main, block: 'accessory' as const }, weeks[6]), { ...main, block: 'accessory', sets: 3, targetRir: 1 });
  });

  it('cel z poprzedniej sesji dopasowany do serii tygodnia', () => {
    const t = { exerciseId: 'x', loadKg: 40, sets: 3, repMin: 8, repMax: 12, repsPerSet: [10, 10, 9], targetRir: 2 };
    assert.deepEqual(fitTargetToSets(t, 2).repsPerSet, [10, 10]);
    assert.deepEqual(fitTargetToSets(t, 4), { ...t, sets: 4, repsPerSet: [10, 10, 9, 9] });
  });

  it('numer tygodnia od startu cyklu', () => {
    assert.equal(currentCycleWeek('2026-10-01T08:00:00Z', '2026-10-01T20:00:00Z'), 1);
    assert.equal(currentCycleWeek('2026-10-01T08:00:00Z', '2026-10-15T09:00:00Z'), 3);
    assert.equal(currentCycleWeek('2026-10-01T08:00:00Z', '2027-02-01T09:00:00Z'), 8);
  });
});

it('biblioteka startowa zgadza się z supabase/seed.sql', () => {
  const seed = readFileSync(new URL('../../../../supabase/seed.sql', import.meta.url), 'utf8');
  for (const e of STARTER_LIBRARY) {
    assert.ok(seed.includes(`('${e.id}', 'a0000000-0000-4000-8000-000000000001', `) && seed.includes(`'${e.name}', '${e.category}'`), e.name);
  }
});
