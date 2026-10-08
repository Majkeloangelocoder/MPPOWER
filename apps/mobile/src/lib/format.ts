export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

export const formatKg = (value: number): string => `${formatNumber(value)} kg`;

/** Wartość do pola tekstowego: 82.5 → "82,5". */
export const formatInput = (value: number): string => formatNumber(value);

export const formatRange = (min: number, max: number): string => (min === max ? `${min}` : `${min}–${max}`);

/** Akceptuje przecinek i kropkę; puste lub błędne pole → null. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** 1 seria, 2–4 serie, 5+ serii (12–14 → serii). */
export function seriesWord(count: number): string {
  if (count === 1) return 'seria';
  const last = count % 10;
  const lastTwo = count % 100;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? 'serie' : 'serii';
}

export const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
