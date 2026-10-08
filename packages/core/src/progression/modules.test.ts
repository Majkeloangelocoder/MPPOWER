import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessDeload, assessReadiness } from './deload.ts';
import { scoreSession } from './session-score.ts';
import { countNewRecords, detectRecords } from './records.ts';
import type { ExerciseExposure, Prescription } from './types.ts';

const ex = (load: number, reps: number, rir: number, id: string): ExerciseExposure => ({
  sessionId: id,
  performedAt: '2026-09-01T10:00:00Z',
  sets: Array.from({ length: 3 }, () => ({ loadKg: load, reps, rir, completed: true })),
});

describe('deload', () => {
  it('spadek wyników w 2 ćwiczeniach + słaby sen → propozycja lżejszego tygodnia', () => {
    const declining = [ex(100, 5, 2, 'a'), ex(102.5, 5, 2, 'b'), ex(100, 3, 1, 'c'), ex(97.5, 3, 1, 'd')];
    const a = assessDeload({
      now: '2026-10-08T12:00:00Z',
      blockStartedAt: '2026-09-20T00:00:00Z',
      keyLifts: [
        { exerciseId: 'squat', targetRir: 2, exposures: declining },
        { exerciseId: 'bench', targetRir: 2, exposures: declining },
      ],
      recovery: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].map((date) => ({ date, sleepHours: 5.5 })),
    });
    assert.equal(a.recommend, true);
    assert.ok(a.score >= 3);
    assert.deepEqual(a.proposal, { durationDays: 7, volumeMultiplier: 0.5, loadMultiplier: 0.9 });
    assert.match(a.explanation, /lżejszy tydzień/);
  });

  it('stabilne wyniki i dobry sen → bez deloadu', () => {
    const stable = [ex(100, 5, 2, 'a'), ex(100, 5, 2, 'b'), ex(102.5, 5, 2, 'c'), ex(102.5, 5, 2, 'd')];
    const a = assessDeload({
      now: '2026-10-08T12:00:00Z',
      blockStartedAt: '2026-09-20T00:00:00Z',
      keyLifts: [{ exerciseId: 'squat', targetRir: 2, exposures: stable }],
      recovery: [{ date: '2026-10-07', sleepHours: 7.5, fatigue: 2 }],
    });
    assert.equal(a.recommend, false);
    assert.equal(a.proposal, null);
  });

  it('8 tygodni bez przerwy przy wysokiej realizacji + zmęczenie → deload', () => {
    const a = assessDeload({
      now: '2026-10-08T12:00:00Z',
      blockStartedAt: '2026-08-10T00:00:00Z',
      adherence: 0.9,
      keyLifts: [],
      recovery: ['2026-10-05', '2026-10-06', '2026-10-07'].map((date) => ({ date, fatigue: 4 })),
    });
    assert.equal(a.recommend, true);
  });

  it('gotowość: wysokie zmęczenie w ostatnich 3 dniach → reduced', () => {
    assert.equal(assessReadiness([{ date: '2026-10-07', fatigue: 4 }], '2026-10-08T08:00:00Z'), 'reduced');
    assert.equal(assessReadiness([{ date: '2026-10-07', sleepHours: 7 }], '2026-10-08T08:00:00Z'), 'ok');
    assert.equal(assessReadiness([{ date: '2026-09-20', fatigue: 5 }], '2026-10-08T08:00:00Z'), 'ok');
  });
});

describe('ocena sesji', () => {
  const p: Prescription = {
    exerciseId: 'squat', sets: 3, repMin: 6, repMax: 8, targetRir: 2,
    model: 'double_progression', loadType: 'external', loadIncrementKg: 2.5,
  };
  const target = { exerciseId: 'squat', loadKg: 80, sets: 3, repMin: 6, repMax: 8, repsPerSet: [8, 8, 8], targetRir: 2 };

  it('cele zrealizowane, RIR w punkt → 10/10', () => {
    const s = scoreSession([{ prescription: p, target, sets: ex(80, 8, 2, 'x').sets }]);
    assert.equal(s.score, 10);
    assert.equal(s.effort, 1);
  });

  it('jedna seria mniej i lżej niż cel → niższa ocena', () => {
    const s = scoreSession([{ prescription: p, target, sets: ex(75, 7, 2, 'x').sets.slice(0, 2) }]);
    assert.ok(s.score <= 7, `score ${s.score}`);
  });

  it('rekord dodaje punkty, ale nie ponad 10', () => {
    const s = scoreSession([{ prescription: p, target, sets: ex(80, 8, 2, 'x').sets }], 3);
    assert.equal(s.score, 10);
  });
});

describe('rekordy', () => {
  it('pierwszy wynik to punkt odniesienia, nie rekord', () => {
    const r = detectRecords('external', ex(80, 8, 2, 'x').sets);
    assert.equal(countNewRecords(r), 0);
    assert.ok(r.every((x) => x.isFirst));
  });

  it('cięższy ciężar → rekord z przyrostem', () => {
    const r = detectRecords('external', ex(82.5, 6, 2, 'x').sets, { heaviest_load: 80, best_e1rm: 106.7 });
    const heaviest = r.find((x) => x.kind === 'heaviest_load');
    assert.equal(heaviest?.improvement, 2.5);
  });

  it('plank: najdłuższe utrzymanie', () => {
    const sets = [{ loadKg: null, reps: 50, completed: true }];
    const r = detectRecords('time', sets, { longest_hold: 45 });
    assert.equal(r[0]?.kind, 'longest_hold');
    assert.equal(r[0]?.improvement, 5);
  });
});
