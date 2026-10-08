import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recommendNext, ENGINE_VERSION } from './engine.ts';
import { decreaseLoad, estimateOneRepMax, roundToIncrement } from './math.ts';
import { formatKg, seriesWord } from './explain.ts';
import type { ExerciseExposure, Prescription } from './types.ts';

const squat: Prescription = {
  exerciseId: 'squat',
  sets: 3,
  repMin: 6,
  repMax: 8,
  targetRir: 2,
  model: 'double_progression',
  loadType: 'external',
  loadIncrementKg: 2.5,
};

/** [ciężar, powtórzenia, RIR?] */
type Row = [number | null, number, number?];

function exposure(rows: Row[], sessionId = 's2'): ExerciseExposure {
  return {
    sessionId,
    performedAt: '2026-10-01T10:00:00Z',
    sets: rows.map(([loadKg, reps, rir]) => ({ loadKg, reps, rir: rir ?? null, completed: true })),
  };
}

const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe('double progression', () => {
  it('przykład z briefu: 80 kg × 8/8/7 przy RIR 1 → zostań przy 80 kg, cel 8/8/8', () => {
    const r = recommendNext(squat, [exposure([[80, 8, 1], [80, 8, 1], [80, 7, 1]])]);
    assert.equal(r.action, 'hold_load');
    assert.equal(r.next.loadKg, 80);
    assert.deepEqual(r.next.repsPerSet, [8, 8, 8]);
    assert.ok(codes(r).includes('RESERVE_LOW'));
    assert.match(r.explanation, /Pozostań przy 80 kg/);
    assert.match(r.explanation, /8\/8\/8/);
    assert.match(r.explanation, /RIR 2/);

    assert.ok(!r.explanation.includes('..'), r.explanation);
  });

  it('wszystkie serie na górze zakresu z zapasem → +2,5 kg i powrót do dołu zakresu', () => {
    const r = recommendNext(squat, [exposure([[80, 8, 2], [80, 8, 2], [80, 8, 3]])]);
    assert.equal(r.action, 'increase_load');
    assert.equal(r.next.loadKg, 82.5);
    assert.deepEqual(r.next.repsPerSet, [6, 6, 6]);
    assert.equal(r.confidence, 'high');
    assert.match(r.explanation, /82,5 kg/);
    assert.ok(!r.explanation.includes('..'), r.explanation);
  });

  it('pełny zakres, ale za mały zapas → bez zwiększania', () => {
    const r = recommendNext(squat, [exposure([[80, 8, 1], [80, 8, 1], [80, 8, 0]])]);
    assert.equal(r.action, 'hold_load');
    assert.deepEqual(r.next.repsPerSet, [8, 8, 8]);
    assert.ok(codes(r).includes('RESERVE_LOW'));
  });

  it('brak zapisanego RIR → zwiększenie, ale ze średnią pewnością', () => {
    const r = recommendNext(squat, [exposure([[80, 8], [80, 8], [80, 8]])]);
    assert.equal(r.action, 'increase_load');
    assert.equal(r.confidence, 'medium');
    assert.ok(codes(r).includes('RIR_NOT_LOGGED'));
  });

  it('dwie sesje z rzędu poniżej dolnego zakresu → zmniejszenie ciężaru', () => {
    const r = recommendNext(squat, [
      exposure([[80, 6, 0], [80, 5, 0], [80, 5, 0]], 's1'),
      exposure([[80, 6, 0], [80, 5, 0], [80, 4, 0]], 's2'),
    ]);
    assert.equal(r.action, 'decrease_load');
    assert.equal(r.next.loadKg, 72.5);
  });

  it('jednorazowo poniżej dolnego zakresu → zostajemy', () => {
    const r = recommendNext(squat, [exposure([[80, 6, 1], [80, 5, 0], [80, 5, 0]])]);
    assert.equal(r.action, 'hold_load');
    assert.ok(codes(r).includes('REPS_BELOW_MIN'));
  });

  it('słabsza regeneracja blokuje zwiększenie ciężaru', () => {
    const r = recommendNext(squat, [exposure([[80, 8, 3], [80, 8, 3], [80, 8, 3]])], {
      level: 'intermediate',
      readiness: 'reduced',
    });
    assert.equal(r.action, 'hold_load');
    assert.ok(codes(r).includes('READINESS_REDUCED'));
  });

  it('nieukończone serie → zostajemy przy ciężarze', () => {
    const r = recommendNext(squat, [exposure([[80, 8, 2], [80, 8, 2]])]);
    assert.equal(r.action, 'hold_load');
    assert.ok(codes(r).includes('INCOMPLETE_SETS'));
    assert.match(r.explanation, /3 serie/);
  });
});

describe('progresja RIR / RPE', () => {
  const bench: Prescription = { ...squat, exerciseId: 'bench', sets: 5, repMin: 5, repMax: 5, model: 'rir' };
  const five = (load: number, rir: number): Row[] => Array.from({ length: 5 }, () => [load, 5, rir] as Row);

  it('wyraźnie lżej niż plan (RIR 4 przy celu 2) → skalowany wzrost, limit 5%', () => {
    const r = recommendNext(bench, [exposure(five(100, 4))]);
    assert.equal(r.action, 'increase_load');
    assert.equal(r.next.loadKg, 105);
  });

  it('dokładnie w celu → +1 krok (poziom średniozaawansowany)', () => {
    const r = recommendNext(bench, [exposure(five(100, 2))]);
    assert.equal(r.action, 'increase_load');
    assert.equal(r.next.loadKg, 102.5);
  });

  it('dokładnie w celu na poziomie zaawansowanym → plan bloku prowadzi progres', () => {
    const r = recommendNext(bench, [exposure(five(100, 2))], { level: 'advanced' });
    assert.equal(r.action, 'hold_load');
    assert.ok(codes(r).includes('ADVANCED_HOLD'));
  });

  it('dużo ciężej niż plan (RIR 0 przy celu 2) → zmniejszenie', () => {
    const r = recommendNext(bench, [exposure(five(100, 0))]);
    assert.equal(r.action, 'decrease_load');
    assert.equal(r.next.loadKg, 95);
  });

  it('model RPE: RPE 8 przy celu RIR 2 jest „w celu”, a tekst mówi językiem RPE', () => {
    const rpe: Prescription = { ...bench, model: 'rpe' };
    const ex: ExerciseExposure = {
      sessionId: 's1',
      performedAt: '2026-10-01T10:00:00Z',
      sets: Array.from({ length: 5 }, () => ({ loadKg: 100, reps: 5, rpe: 8, completed: true })),
    };
    const r = recommendNext(rpe, [ex]);
    assert.equal(r.action, 'increase_load');
    assert.match(r.explanation, /RPE 8/);
  });
});

describe('progresja objętości', () => {
  const row: Prescription = { ...squat, exerciseId: 'row', repMin: 8, repMax: 12, model: 'volume', maxSets: 5 };

  it('serie w zakresie z zapasem → +1 seria', () => {
    const r = recommendNext(row, [exposure([[60, 10, 2], [60, 10, 2], [60, 9, 2]])]);
    assert.equal(r.action, 'add_set');
    assert.equal(r.next.sets, 4);
    assert.equal(r.next.loadKg, 60);
  });

  it('limit serii osiągnięty → stop, bez dokładania', () => {
    const r = recommendNext(row, [exposure([[60, 10, 2], [60, 10, 2], [60, 10, 2], [60, 9, 2], [60, 9, 2]])]);
    assert.equal(r.action, 'hold_load');
    assert.ok(codes(r).includes('VOLUME_CAP'));
    assert.match(r.explanation, /5 serii/);
  });
});

describe('masa ciała i ćwiczenia na czas', () => {
  const pushUp: Prescription = {
    exerciseId: 'push-up',
    sets: 3,
    repMin: 8,
    repMax: 15,
    targetRir: 2,
    model: 'double_progression',
    loadType: 'bodyweight',
    loadIncrementKg: 0,
    progressionExerciseId: 'decline-push-up',
  };

  it('pełny zakres z zapasem → trudniejszy wariant', () => {
    const r = recommendNext(pushUp, [exposure([[null, 15, 2], [null, 15, 2], [null, 15, 3]])]);
    assert.equal(r.action, 'progress_variant');
    assert.equal(r.next.exerciseId, 'decline-push-up');
    assert.deepEqual(r.next.repsPerSet, [8, 8, 8]);
  });

  it('poniżej góry zakresu → +1 powtórzenie na serię', () => {
    const r = recommendNext(pushUp, [exposure([[null, 12], [null, 11], [null, 10]])]);
    assert.equal(r.action, 'increase_reps');
    assert.deepEqual(r.next.repsPerSet, [13, 12, 11]);
  });

  it('brak wariantu w bibliotece → dodatkowa seria', () => {
    const r = recommendNext({ ...pushUp, progressionExerciseId: null }, [exposure([[null, 15], [null, 15], [null, 15]])]);
    assert.equal(r.action, 'add_set');
    assert.deepEqual(r.next.repsPerSet, [15, 15, 15, 8]);
  });

  it('plank na czas → +5 s na serię', () => {
    const plank: Prescription = { ...pushUp, exerciseId: 'plank', repMin: 30, repMax: 60, loadType: 'time', progressionExerciseId: null };
    const r = recommendNext(plank, [exposure([[null, 40], [null, 40], [null, 35]])]);
    assert.equal(r.action, 'increase_reps');
    assert.deepEqual(r.next.repsPerSet, [45, 45, 40]);
    assert.match(r.explanation, /s\b/);
  });
});

describe('przypadki brzegowe', () => {
  it('brak historii → kalibracja z niską pewnością', () => {
    const r = recommendNext(squat, []);
    assert.equal(r.action, 'calibrate');
    assert.equal(r.next.loadKg, null);
    assert.equal(r.confidence, 'low');
    assert.match(r.explanation, /Pierwsze wykonanie/);
  });

  it('błędna recepta → RangeError', () => {
    assert.throws(() => recommendNext({ ...squat, repMax: 4 }, []), RangeError);
    assert.throws(() => recommendNext({ ...squat, loadIncrementKg: 0 }, []), RangeError);
  });

  it('deterministyczność i wersja silnika', () => {
    const history = [exposure([[80, 8, 2], [80, 7, 2], [80, 7, 2]])];
    assert.deepEqual(recommendNext(squat, history), recommendNext(squat, history));
    assert.equal(recommendNext(squat, history).engineVersion, ENGINE_VERSION);
  });
});

describe('matematyka i formatowanie', () => {
  it('e1RM uwzględnia RIR', () => {
    assert.equal(estimateOneRepMax(100, 5, 2), 123.3);
    assert.equal(estimateOneRepMax(100, 1, 0), 100);
    assert.equal(estimateOneRepMax(100, 14, 3), null);
  });

  it('zaokrąglanie do talerzy i bezpieczne zmniejszanie', () => {
    assert.equal(roundToIncrement(81.3, 2.5), 82.5);
    assert.equal(roundToIncrement(81.3, 2.5, 'down'), 80);
    assert.equal(decreaseLoad(2.5, 2.5, 0.1), 0);
  });

  it('polskie formaty', () => {
    assert.equal(formatKg(82.5), '82,5 kg');
    assert.equal(seriesWord(1), 'seria');
    assert.equal(seriesWord(3), 'serie');
    assert.equal(seriesWord(5), 'serii');
    assert.equal(seriesWord(12), 'serii');
    assert.equal(seriesWord(22), 'serie');
  });
});
