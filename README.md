# MP POWER Coach — FIRST BUILD (części 1–3)

Działający wycinek produktu od końca do końca: logowanie → trening z planu → zapis serii → silnik progresji → AI Review z celami na następny raz.

| Element | Ścieżka | Weryfikacja |
| --- | --- | --- |
| Silnik progresji, deload, gotowość, ocena sesji, rekordy | `packages/core/src/progression/` | testy jednostkowe |
| Cele żywieniowe z bezpiecznikami | `packages/core/src/nutrition/` | testy jednostkowe |
| Uprawnienia planów FREE / PRO / PREMIUM | `packages/core/src/billing/` | testy jednostkowe |
| Kontrakty API (wspólne typy aplikacji i serwera) | `packages/core/src/api/contracts.ts` | kontrola typów |
| AI Gateway (Claude + zapasowo OpenAI), AI Review z kontrolą liczb, sygnały alarmowe | `packages/ai/src/` | testy jednostkowe |
| API: trening, uprawnienia, Stripe (Next.js 16) | `apps/web/` | `next build` + test E2E na lokalnym Supabase |
| Aplikacja mobilna (Expo SDK 57): logowanie, Dziś, Workout Player, podsumowanie | `apps/mobile/` | kontrola typów, bundle Android/iOS/web, przeklikana wersja web |
| Baza: 47 tabel, RLS, funkcje treningowe, historia ćwiczeń, zgody z rejestracji | `supabase/migrations/` | `supabase start` + test E2E (w tym RLS) |

**Status:** wszystko poza Stripe i prawdziwym telefonem zostało uruchomione: migracje na lokalnym Supabase, API, test E2E (`pnpm e2e`) i aplikacja w przeglądarce — rejestracja, trening, podsumowanie i cele na kolejny raz. Stripe wymaga kluczy; na telefonie sprawdź w Expo Go.

## 0. Wymagania

Node.js 22.18+, pnpm 10, Git, Docker Desktop, telefon z aplikacją Expo Go (w tej samej sieci Wi-Fi co komputer).

## 1. Instalacja i testy

```bash
pnpm install
pnpm test          # testy pakietów core i ai
pnpm typecheck     # core, ai, web, mobile
```

## 2. Baza danych (lokalnie)

```bash
pnpm db:start      # wypisze adres API, klucz publiczny (publishable) i serwisowy (secret)
pnpm db:reset      # migracje + dane testowe: 20 ćwiczeń i program Full Body A/B (opcjonalnie — start już je wgrywa)
```

`npx supabase status` pokaże klucze ponownie.

## 3. API (Next.js)

```bash
cp .env.example apps/web/.env.local
pnpm dev:web
```

W `apps/web/.env.local`: `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_SECRET_KEY` (klucz serwisowy z kroku 2), `ANTHROPIC_API_KEY` (bez niego podsumowania są z reguł), `APP_URL=http://localhost:3000`.

**Test końca do końca** (rejestracja → plan → dwa treningi → cele z progresji → izolacja danych innego użytkownika):

```bash
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... pnpm e2e
```

## 4. Aplikacja mobilna (Expo)

```bash
cd apps/mobile
cp .env.example .env    # wpisz adres IP komputera i klucz publiczny Supabase
cd ../..
pnpm dev:mobile         # zeskanuj kod QR w Expo Go
```

Telefon nie widzi „localhost” komputera — w `apps/mobile/.env` podaj adres IP komputera w sieci Wi-Fi (np. `http://192.168.1.20:3000` dla API i `http://192.168.1.20:54321` dla Supabase). Plik `.npmrc` (`node-linker=hoisted`) jest potrzebny, żeby Expo działało w monorepo pnpm. Ikony i ekran startowy to na razie domyślne Expo — dodaj własne w `apps/mobile/app.json` przed publikacją.

**Wersja demo w przeglądarce** (bez bazy i API — dane w pamięci przeglądarki, prawdziwy silnik progresji):

```bash
cd apps/mobile && pnpm demo:web    # wynik w apps/mobile/dist-demo
```

**Test na telefonie**

1. Załóż konto (potwierdzenie 18+ i zgód zapisuje się w bazie razem z kontem).
2. Ekran Dziś → Full Body A → Zacznij trening.
3. Zapisuj serie (ciężar, powtórzenia, zapas RIR, ✓) — po każdej serii startuje timer przerwy; trening przetrwa zamknięcie aplikacji.
4. Zakończ trening → podsumowanie: ocena, rekordy, cele na następny raz z wyjaśnieniem „Dlaczego?”.
5. Przy kolejnym treningu tego dnia pola są już wypełnione celami z silnika progresji.

## 5. API — endpointy

| Endpoint | Metoda | Co robi | Dostęp |
| --- | --- | --- | --- |
| `/api/v1/sessions` | POST | Start treningu (idempotentny) → payload Workout Player | Zalogowany; program musi być w jego planie |
| `/api/v1/sessions/{id}` | GET | Wznowienie treningu | Właściciel sesji |
| `/api/v1/sessions/{id}/complete` | POST | Serie → progresja → rekordy → ocena → AI Review → zapis atomowy | Właściciel; tekst AI w PRO, w FREE z reguł |
| `/api/v1/me/entitlements` | GET | Plan, funkcje, limity | Zalogowany |
| `/api/v1/billing/checkout` | POST | Stripe Checkout z trialem i kodami | Zalogowany |
| `/api/v1/billing/portal` | POST | Stripe Customer Portal | Zalogowany z zakupem na web |
| `/api/v1/billing/stripe-webhook` | POST | Subskrypcje → uprawnienia (idempotentnie) | Podpis Stripe |

**Stripe:** utwórz produkty PRO i PREMIUM (ceny miesięczne i roczne) i dodaj ich identyfikatory do tabeli `prices`. Webhook lokalnie: `stripe listen --forward-to localhost:3000/api/v1/billing/stripe-webhook`.

## 6. Produkcja (skrót)

- Supabase w chmurze (region Frankfurt): `npx supabase login`, `npx supabase link`, `npx supabase db push`. Dane testowe nie trafiają tam same — na start wklej `supabase/seed.sql` w edytorze SQL, docelowo treści dodasz w panelu.
- Vercel: import repozytorium, katalog główny projektu `apps/web`, zmienne środowiskowe.
- Expo EAS Build → TestFlight i testy wewnętrzne Google Play. Przed publikacją: zakupy w aplikacji (RevenueCat), polityka prywatności, usuwanie konta w aplikacji, szyfrowany magazyn sesji.

## Zasady, których pilnuje kod

- Rekomendacje liczy deterministyczny silnik; AI tylko je opisuje, a tekst z liczbą spoza faktów zostaje odrzucony.
- Ciężar rośnie dopiero, gdy wszystkie serie osiągną górę zakresu z zapasem ≥ docelowy RIR; nadpisanie trenera zawsze wygrywa.
- Uprawnienia rozstrzyga serwer; zgubiony webhook nie daje darmowego dostępu, a nieudana płatność daje 7 dni okresu łaski.
- Serii nie da się podpiąć pod cudzą sesję; historię czatu, rekomendacje i płatności zapisuje wyłącznie serwer.
