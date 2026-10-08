import { bestE1rm, isNumber, round2 } from './math.ts';
import type { LoadType, LoggedSet } from './types.ts';

export type RecordKind = 'heaviest_load' | 'best_e1rm' | 'most_reps' | 'longest_hold';
export type PreviousBests = Partial<Record<RecordKind, number>>;

export interface PersonalRecord {
  kind: RecordKind;
  value: number;
  previous: number | null;
  improvement: number | null;
  /** Pierwszy wynik to punkt odniesienia, a nie „rekord” do świętowania. */
  isFirst: boolean;
}

export function detectRecords(
  loadType: LoadType,
  sets: readonly LoggedSet[],
  previous: PreviousBests = {},
): PersonalRecord[] {
  const done = sets.filter((s) => s.completed && s.reps > 0);
  if (done.length === 0) return [];
  const out: PersonalRecord[] = [];
  const consider = (kind: RecordKind, value: number, minGain: number) => {
    const prev = previous[kind];
    if (prev === undefined) {
      out.push({ kind, value, previous: null, improvement: null, isFirst: true });
    } else if (value > prev + minGain) {
      out.push({ kind, value, previous: prev, improvement: round2(value - prev), isFirst: false });
    }
  };

  if (loadType === 'external') {
    const loads = done.map((s) => s.loadKg).filter(isNumber);
    if (loads.length > 0) consider('heaviest_load', Math.max(...loads), 0);
    const e1 = bestE1rm(done);
    // e1RM to szacunek — rekord dopiero przy wzroście > 0,5 kg, żeby nie świętować szumu.
    if (e1 !== null) consider('best_e1rm', e1, 0.5);
  } else {
    consider(loadType === 'time' ? 'longest_hold' : 'most_reps', Math.max(...done.map((s) => s.reps)), 0);
  }
  return out;
}

export function countNewRecords(records: readonly PersonalRecord[]): number {
  return records.filter((r) => !r.isFirst).length;
}
