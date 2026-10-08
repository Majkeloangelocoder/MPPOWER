/**
 * Pierwsza linia bezpieczeństwa czatu: deterministyczne wykrywanie sygnałów alarmowych
 * przed wywołaniem modelu. Nie diagnozuje — kieruje do pomocy. Wzorce i treści komunikatów
 * powinien zatwierdzić fizjoterapeuta zespołu MP POWER; w MVP2 dochodzi klasyfikator AI.
 */
export type SafetyCategory = 'emergency' | 'eating_concern' | 'medical_consult';

export interface SafetyAssessment {
  category: SafetyCategory | null;
  /** Dopasowane wzorce — do logów i przeglądu, nie dla użytkownika. */
  matched: string[];
}

/** Małe litery, bez polskich znaków (ł → l), pojedyncze spacje. */
export function normalizePl(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULES: ReadonlyArray<{ category: SafetyCategory; patterns: readonly RegExp[] }> = [
  {
    category: 'emergency',
    patterns: [
      /(bol\w*|ucisk\w*|kluj\w*|piecz\w*|gniot\w*)[^.?!]{0,30}klat\w*/,
      /klat\w*[^.?!]{0,30}(boli|bol\w*|ucisk\w*|kluj\w*|piecz\w*)/,
      /\bduszn\w*|\bdusze sie\b|\bdusi mnie\b|nie moge zlapac tchu/,
      /zemdl\w*|omdl\w*|\bstracil\w* przytomn\w*|\butrat\w* przytomn\w*/,
      /dretw\w*[^.?!]{0,25}(polow\w* ciala|polow\w* twarzy|twarz\w*)|opadaj\w* kacik\w*|\bbelkot\w*/,
      /nietrzym\w* (moczu|stolca)|dretw\w*[^.?!]{0,20}krocz\w*/,
      /(ciemn\w*|brazow\w*|kolor\w* coli)[^.?!]{0,10}mocz\w*/,
      /najgorsz\w* bol\w* glowy|nagl\w* (bardzo )?silny bol\w* glowy/,
    ],
  },
  {
    category: 'eating_concern',
    patterns: [
      /prowokuj\w* wymiot\w*|wymiotuj\w* po jedzeniu|\bzwracam po jedzeniu/,
      /srodk\w* przeczyszcz\w*|przeczyszczaj\w*/,
      /glodz\w* sie|nie (jem|jadlem|jadlam) od (\d+|kilku|paru) dni/,
      /za kare (nie jem|cwicze)|kara za jedzenie/,
    ],
  },
  {
    category: 'medical_consult',
    patterns: [
      /\bostr\w* bol\w*|\bbol\w* ostr\w*/,
      /\bkluj\w*|przeszyw\w*|\brwac\w*/,
      /promieniuj\w*/,
      /dretw\w*|mrowi\w*/,
      /obrzek\w*|opuch\w*|spuchl\w*/,
      /\btrzas\w*|\bstrzel\w*[^.?!]{0,20}(kolan\w*|bark\w*|staw\w*)/,
      /nie moge (obciaz\w*|stanac|podniesc rek\w*)/,
      /bol\w*[^.?!]{0,30}(w nocy|nie przechodzi|od tygodni|coraz wieksz\w*|coraz mocniej)/,
      /po upadku|po urazie|skrec\w*|zwichn\w*/,
    ],
  },
];

export function assessMessageSafety(text: string): SafetyAssessment {
  const normalized = normalizePl(text);
  for (const rule of RULES) {
    const matched = rule.patterns.filter((p) => p.test(normalized)).map((p) => p.source);
    if (matched.length > 0) return { category: rule.category, matched };
  }
  return { category: null, matched: [] };
}

export const SAFETY_RESPONSES: Readonly<Record<SafetyCategory, string>> = {
  emergency:
    'Jeśli to nagły ucisk lub ból w klatce piersiowej, duszność, omdlenie, drętwienie połowy ciała, zaburzenia mowy, utrata kontroli nad pęcherzem albo bardzo ciemny mocz po wysiłku — przerwij trening i zadzwoń pod 112. Jeśli chodzi o zwykłą bolesność mięśni po treningu, napisz to wprost, a pomogę dopasować plan.',
  eating_concern:
    'Dziękuję, że o tym piszesz. To, co opisujesz, zasługuje na wsparcie specjalisty — lekarza, psychologa albo dietetyka. Na ten czas wyłączamy w aplikacji cele kaloryczne, żeby liczby nie dokładały presji. Możesz też zadzwonić pod bezpłatny numer 116 123 (wsparcie w kryzysie emocjonalnym), a jeśli czujesz się w niebezpieczeństwie — pod 112.',
  medical_consult:
    'Przerwij to ćwiczenie. Ostry, kłujący lub promieniujący ból, drętwienie, mrowienie albo obrzęk powinien ocenić fizjoterapeuta lub lekarz — aplikacja tego nie ocenia. Mogę teraz zaproponować zamiennik, który nie obciąża tego obszaru, albo pomóc umówić konsultację.',
};
