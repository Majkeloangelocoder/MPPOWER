import type { AIGateway } from '../gateway.ts';

export const SESSION_REVIEW_PROMPT_VERSION = 'session_review@1';

export type ReviewRecordKind = 'heaviest_load' | 'best_e1rm' | 'most_reps' | 'longest_hold';

/** Fakty z silnika progresji — jedyne liczby, których AI może użyć. */
export interface SessionReviewFacts {
  score: number;
  records: Array<{ exerciseName: string; kind: ReviewRecordKind; value: number; improvement: number | null }>;
  nextTargets: Array<{
    exerciseName: string;
    action: string;
    loadKg: number | null;
    repMin: number;
    repMax: number;
    sets: number;
    explanation: string;
  }>;
}

export interface SessionReview {
  headline: string;
  summary: string;
  nextFocus: string;
  source: 'ai' | 'rules';
}

export const SESSION_REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    nextFocus: { type: 'string' },
  },
  required: ['headline', 'summary', 'nextFocus'],
  additionalProperties: false,
};

export const SESSION_REVIEW_SYSTEM = [
  'Jesteś MP POWER Coach — trenerem w aplikacji MP POWER. Piszesz po polsku, w drugiej osobie, krótko i konkretnie, bez emoji.',
  'Dostajesz fakty o właśnie zakończonym treningu (JSON): ocenę 1–10, rekordy i cele na następny raz wyliczone przez silnik progresji.',
  'Zasady:',
  '- Używaj wyłącznie liczb z JSON. Nie wymyślaj ciężarów, powtórzeń ani wyników.',
  '- Nie zmieniaj celów — możesz je tylko krótko uzasadnić.',
  '- Nie oceniaj zdrowia i niczego nie diagnozuj.',
  '- headline: najwyżej 6 słów, zawiera ocenę w formacie X/10.',
  '- summary: 1–2 zdania o tym, co poszło najlepiej.',
  '- nextFocus: 1 zdanie z najważniejszym celem na następny trening.',
].join('\n');

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

const formatKg = (value: number) => `${formatNumber(value)} kg`;
const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);

const RECORD_PRIORITY: ReviewRecordKind[] = ['heaviest_load', 'best_e1rm', 'most_reps', 'longest_hold'];
const ACTION_PRIORITY = ['increase_load', 'decrease_load', 'progress_variant', 'add_set', 'hold_load', 'increase_reps', 'calibrate'];

function describeRecord(r: SessionReviewFacts['records'][number]): string {
  switch (r.kind) {
    case 'heaviest_load':
      return r.improvement !== null ? `+${formatKg(r.improvement)} (${formatKg(r.value)})` : formatKg(r.value);
    case 'best_e1rm':
      return `szacowany 1RM ${formatKg(r.value)}`;
    case 'most_reps':
      return r.improvement !== null ? `${r.value} powt. (+${r.improvement})` : `${r.value} powt.`;
    case 'longest_hold':
      return r.improvement !== null ? `${r.value} s (+${r.improvement} s)` : `${r.value} s`;
  }
}

function describeTarget(t: SessionReviewFacts['nextTargets'][number]): string {
  if (t.action === 'progress_variant') return `trudniejszy wariant, start od ${t.repMin} powt.`;
  if (t.loadKg !== null) return `${formatKg(t.loadKg)} × ${range(t.repMin, t.repMax)}`;
  return `${t.sets}×${range(t.repMin, t.repMax)}`;
}

/** Podsumowanie bez AI — zawsze działa i jest punktem odniesienia dla tekstu z modelu. */
export function buildRuleBasedReview(f: SessionReviewFacts): SessionReview {
  const best = [...f.records].sort((a, b) => RECORD_PRIORITY.indexOf(a.kind) - RECORD_PRIORITY.indexOf(b.kind))[0];
  let summary: string;
  if (best) summary = `Najlepszy wynik: ${best.exerciseName} ${describeRecord(best)}.`;
  else if (f.score >= 8) summary = 'Plan zrealizowany — tak buduje się progres.';
  else if (f.score >= 5) summary = 'Dobra robota — część celów domkniesz następnym razem.';
  else summary = 'Trudniejszy dzień. Liczy się, że trening się odbył.';

  const focus = [...f.nextTargets].sort((a, b) => ACTION_PRIORITY.indexOf(a.action) - ACTION_PRIORITY.indexOf(b.action))[0];
  const nextFocus = focus
    ? `Następnym razem: ${focus.exerciseName} — ${describeTarget(focus)}.`
    : 'Następnym razem: utrzymaj dzisiejsze cele.';
  return { headline: `Dzisiejszy trening: ${f.score}/10`, summary, nextFocus, source: 'rules' };
}

const NUMBER = /\d+(?:[.,]\d+)?/g;

export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((s) => Number(s.replace(',', '.')));
}

/** Każda liczba w tekście AI musi pochodzić z faktów — inaczej używamy podsumowania z reguł. */
export function isGrounded(text: string, f: SessionReviewFacts): boolean {
  const allowed = new Set<number>([f.score, 10, 1, f.records.length, f.nextTargets.length]);
  for (const r of f.records) {
    allowed.add(r.value);
    if (r.improvement !== null) allowed.add(r.improvement);
  }
  for (const t of f.nextTargets) {
    if (t.loadKg !== null) allowed.add(t.loadKg);
    allowed.add(t.repMin);
    allowed.add(t.repMax);
    allowed.add(t.sets);
    for (const n of extractNumbers(t.explanation)) allowed.add(n);
  }
  const list = [...allowed];
  return extractNumbers(text).every((n) => list.some((a) => Math.abs(a - n) < 0.01));
}

function parseReview(value: unknown): Omit<SessionReview, 'source'> | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const ok = (s: unknown, max: number) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  if (!ok(v.headline, 80) || !ok(v.summary, 300) || !ok(v.nextFocus, 300)) return null;
  return { headline: String(v.headline).trim(), summary: String(v.summary).trim(), nextFocus: String(v.nextFocus).trim() };
}

/**
 * Tekst AI Review: model pisze, ale nie decyduje. Brak AI, błąd, zły format albo liczba
 * spoza faktów → deterministyczne podsumowanie z reguł.
 */
export async function generateSessionReview(
  gateway: Pick<AIGateway, 'run'> | null,
  facts: SessionReviewFacts,
  opts: { allowAi: boolean; userId?: string },
): Promise<SessionReview> {
  const fallback = buildRuleBasedReview(facts);
  if (!gateway || !opts.allowAi) return fallback;
  try {
    const res = await gateway.run('session_review', {
      system: SESSION_REVIEW_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      jsonSchema: { name: 'session_review', schema: SESSION_REVIEW_SCHEMA },
      userId: opts.userId,
    });
    const review = parseReview(res.json);
    if (!review || !isGrounded(`${review.headline} ${review.summary} ${review.nextFocus}`, facts)) return fallback;
    return { ...review, source: 'ai' };
  } catch {
    return fallback;
  }
}
