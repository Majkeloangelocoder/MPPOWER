import type { NextTarget, Prescription, Reason, ReasonCode, RecommendationAction } from './types.ts';

/** 82.5 → "82,5" (polski separator dziesiętny, bez zależności od Intl). */
export function formatNumber(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded).replace('.', ',');
}

export function formatKg(value: number): string {
  return `${formatNumber(value)} kg`;
}

export function formatRange(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

/** Odmiana: 1 seria, 2–4 serie, 5+ serii (12–14 → serii). */
export function seriesWord(count: number): string {
  if (count === 1) return 'seria';
  const last = count % 10;
  const lastTwo = count % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'serie';
  return 'serii';
}

function seriesCount(count: number): string {
  return `${count} ${seriesWord(count)}`;
}

interface ExplainInput {
  prescription: Prescription;
  action: RecommendationAction;
  next: NextTarget;
  reasons: readonly Reason[];
  previousLoadKg: number | null;
}

function has(reasons: readonly Reason[], code: ReasonCode): Reason | undefined {
  return reasons.find((r) => r.code === code);
}

function param(reason: Reason | undefined, key: string): string {
  const value = reason?.params?.[key];
  if (value === undefined) return '?';
  return typeof value === 'number' ? formatNumber(value, 1) : value;
}

/** Wartość RIR albo RPE — zależnie od modelu, w którym myśli użytkownik. */
function effortLabel(p: Prescription, rir: string): string {
  if (p.model !== 'rpe' || rir === '?') return `RIR ${rir}`;
  const asNumber = Number(rir.replace(',', '.'));
  return `RPE ${formatNumber(10 - asNumber, 1)}`;
}

/**
 * Buduje wyjaśnienie z kodów powodów. Tekst jest deterministyczny,
 * więc działa także wtedy, gdy warstwa AI jest niedostępna.
 */
export function buildExplanation(input: ExplainInput): string {
  const { prescription: p, action, next, reasons } = input;
  const unit = p.loadType === 'time' ? 's' : 'powt.';
  const range = formatRange(p.repMin, p.repMax);
  const targets = next.repsPerSet.join('/');
  const load = next.loadKg !== null ? formatKg(next.loadKg) : null;
  const prev = input.previousLoadKg !== null ? formatKg(input.previousLoadKg) : null;
  const targetRir = formatNumber(p.targetRir, 1);
  const readiness = has(reasons, 'READINESS_REDUCED');

  switch (action) {
    case 'calibrate': {
      if (p.loadType === 'time') {
        return `Pierwsze wykonanie. Zrób ${seriesCount(p.sets)} po ${range} s z zapasem sił — bez walki do upadku. Po treningu zaproponujemy kolejny krok.`;
      }
      if (p.loadType === 'bodyweight') {
        return `Pierwsze wykonanie. Zrób ${seriesCount(p.sets)} po ${range} powt., zostawiając ok. ${targetRir} powt. zapasu. Po treningu zaproponujemy kolejny krok.`;
      }
      return `Pierwsze wykonanie. Zrób ${seriesCount(p.sets)} po ${range} powt. z takim ciężarem, by zostało ok. ${targetRir} powt. zapasu (${effortLabel(p, targetRir)}). Po treningu zaproponujemy kolejny krok.`;
    }

    case 'increase_load': {
      const head = `Zwiększ ciężar do ${load}${prev ? ` (z ${prev})` : ''}.`;
      if (has(reasons, 'ALL_SETS_AT_TOP')) {
        const reserve = has(reasons, 'RIR_NOT_LOGGED')
          ? ' Zapisuj też RIR — decyzje będą dokładniejsze.'
          : ` z zapasem ${effortLabel(p, targetRir)} lub większym.`;
        const sentence = has(reasons, 'RIR_NOT_LOGGED')
          ? `Wszystkie serie w górnym zakresie (${p.repMax} ${unit}).${reserve}`
          : `Wszystkie serie w górnym zakresie (${p.repMax} ${unit})${reserve}`;
        return `${head} ${sentence} Cel: ${next.sets}×${range} ${unit}.`;
      }
      const above = has(reasons, 'RIR_ABOVE_TARGET');
      if (above) {
        return `${head} Ostatnio średnio ${effortLabel(p, param(above, 'avgRir'))} przy celu ${effortLabel(p, targetRir)} — ciężar był za lekki. Cel: ${next.sets}×${range} ${unit}.`;
      }
      return `${head} Trafiłeś w cel ${effortLabel(p, targetRir)} — mały krok w górę. Cel: ${next.sets}×${range} ${unit}.`;
    }

    case 'hold_load': {
      const head = `Pozostań przy ${load ?? prev ?? 'obecnym ciężarze'}.`;
      if (readiness) {
        return `${head} Wynik pozwalał na więcej, ale regeneracja w ostatnich dniach jest słabsza — dziś skup się na jakości ruchu. Cel: ${targets} ${unit}.`;
      }
      if (has(reasons, 'INCOMPLETE_SETS')) {
        return `${head} Nie wszystkie serie zostały ukończone. Cel: ${seriesCount(next.sets)}, ${targets} ${unit}.`;
      }
      if (has(reasons, 'VOLUME_CAP')) {
        return `${head} Masz już ${seriesCount(next.sets)} — to limit objętości w tym bloku. Kolejny krok to lżejszy tydzień albo nowy blok.`;
      }
      if (has(reasons, 'ADVANCED_HOLD')) {
        return `${head} Trafiłeś w cel ${effortLabel(p, targetRir)}. Na Twoim poziomie progres prowadzi plan bloku, nie pojedyncza sesja.`;
      }
      const below = has(reasons, 'RIR_BELOW_TARGET');
      if (below) {
        return `${head} Ostatnio średnio ${effortLabel(p, param(below, 'avgRir'))} przy celu ${effortLabel(p, targetRir)} — trochę za ciężko. Cel: ${targets} ${unit} z ${effortLabel(p, targetRir)}.`;
      }
      if (has(reasons, 'REPS_BELOW_MIN')) {
        return `${head} W części serii zabrakło do ${p.repMin} ${unit} — to mógł być słabszy dzień. Cel: ${targets} ${unit}.`;
      }
      const low = has(reasons, 'RESERVE_LOW');
      if (has(reasons, 'ALL_SETS_AT_TOP') && low) {
        return `${head} Zrobiłeś pełny zakres (${p.repMax} ${unit}), ale z małym zapasem (${effortLabel(p, param(low, 'minRir'))}). Powtórz ${next.sets}×${p.repMax} z ${effortLabel(p, targetRir)} lub większym zapasem — wtedy podniesiemy ciężar.`;
      }
      let text = `${head} Cel na następny raz: ${targets} ${unit}. Ciężar zwiększymy, gdy zrobisz wszystkie serie po ${p.repMax} ${unit} z ${effortLabel(p, targetRir)} lub większym zapasem.`;
      if (low) {
        text += ` Ostatnio zostawiłeś ${effortLabel(p, param(low, 'minRir'))} — mniej niż planowane ${effortLabel(p, targetRir)}.`;
      }
      return text;
    }

    case 'decrease_load': {
      const head = `Zmniejsz ciężar do ${load}${prev ? ` (z ${prev})` : ''}.`;
      const far = has(reasons, 'RIR_FAR_BELOW_TARGET');
      if (far) {
        return `${head} Średnio ${effortLabel(p, param(far, 'avgRir'))} przy celu ${effortLabel(p, targetRir)} — ciężar był wyraźnie za duży. Cel: ${targets} ${unit}.`;
      }
      return `${head} Dwie sesje z rzędu poniżej ${p.repMin} ${unit} — lżejszy ciężar pozwoli wrócić do progresji z dobrą techniką. Cel: ${targets} ${unit}.`;
    }

    case 'increase_reps': {
      if (readiness) {
        return `Utrzymaj ${targets} ${unit}. Regeneracja w ostatnich dniach jest słabsza — dziś bez dokładania.`;
      }
      if (has(reasons, 'VOLUME_CAP')) {
        return `Utrzymaj ${next.sets}×${p.repMax} ${unit}. Brakuje trudniejszego wariantu tego ćwiczenia — trener może go dodać w bibliotece.`;
      }
      const low = has(reasons, 'RESERVE_LOW');
      if (has(reasons, 'ALL_SETS_AT_TOP') && low) {
        return `Powtórz ${next.sets}×${p.repMax} ${unit} z ${effortLabel(p, targetRir)} lub większym zapasem — wtedy przejdziemy dalej.`;
      }
      return `Cel: ${targets} ${unit}. Gdy zrobisz ${next.sets}×${p.repMax} ${unit} z ${effortLabel(p, targetRir)} lub większym zapasem, przejdziemy do trudniejszej wersji.`;
    }

    case 'add_set': {
      const what = next.loadKg !== null ? `${seriesCount(next.sets)} po ${formatKg(next.loadKg)}` : seriesCount(next.sets);
      return `Dodaj serię: ${what}, cel ${targets} ${unit}. Wszystkie serie w zakresie z zapasem — to dobry moment na większą objętość.`;
    }

    case 'progress_variant':
      return `Czas na trudniejszy wariant ćwiczenia. Zrobiłeś ${next.sets}×${p.repMax} ${unit} z zapasem — w nowym wariancie zacznij od ${next.repMin} ${unit} na serię.`;
  }
}
