# MP POWER Coach — FIRST BUILD (części 1–3)

Działający wycinek produktu od końca do końca: logowanie → trening z planu → zapis serii → silnik progresji → AI Review z celami na następny raz.

| Element | Ścieżka | Weryfikacja |
| --- | --- | --- |
| Silnik progresji, deload, gotowość, ocena sesji, rekordy | `packages/core/src/progression/` | 35 testów |
| Cele żywieniowe z bezpiecznikami | `packages/core/src/nutrition/` | 5 testów |
| Uprawnienia planów FREE / PRO / PREMIUM | `packages/core/src/billing/` | 6 testów |
| Kontrakty API (wspólne typy aplikacji i serwera) | `packages/core/src/api/contracts.ts` | kontrola typów |
| AI Gateway (Claude + zapasowo OpenAI), AI Review z kontrolą liczb, sygnały alarmowe | `packages/ai/src/` | 18 testów |
| API: trening, uprawnienia, Stripe | `apps/web/` | kontrola typów* |
| Aplikacja mobilna: logowanie, Dziś, Workout Player, podsumowanie | `apps/mobile-src/` | kontrola typów* |
| Baza: 47 tabel, RLS, funkcje treningowe, historia ćwiczeń, zgody z rejestracji | `supabase/migrations/` | statyczna kontrola spójności |

\* API i aplikację sprawdziłem kontrolą typów z uproszczonymi deklaracjami bibliotek (bez dostępu do sieci). Pełną kontrolę zrobi `pnpm -r typecheck` po instalacji pakietów. Nic z tego nie było jeszcze uruchomione na prawdziwym Supabase, Stripe ani telefonie — jeśli coś zgłosi błąd, wklej komunikat.

## 0. Wymagania

Node.js 22.18+, pnpm, Git, Docker Desktop, telefon z aplikacją Expo Go (w tej samej sieci Wi-Fi co komputer).

## 1. Kod i testy

```bash
cd mp-power-coach
pnpm install
cd packages/core && node --test "src/**/*.test.ts"
cd ../ai && node --test "src/**/*.test.ts"
```

## 2. Baza danych (lokalnie)

```bash
npx supabase init
npx supabase start      # wypisze adres API, klucz publiczny (publishable/anon) i serwisowy (secret/service_role)
npx supabase db reset   # migracje + dane testowe: 20 ćwiczeń i program Full Body A/B
```

## 3. API (Next.js)

```bash
cd apps/web
pnpm add next react react-dom @supabase/supabase-js stripe zod
pnpm add -D typescript @types/node @types/react
cp ../../.env.example .env.local
pnpm dev
```

W `.env.local`: `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_SECRET_KEY` (klucz serwisowy z kroku 2), `ANTHROPIC_API_KEY` (bez niego podsumowania są z reguł), `APP_URL=http://localhost:3000`.

## 4. Aplikacja mobilna (Expo)

```bash
# z katalogu głównego repozytorium
cd apps
npx create-expo-app@latest mobile --template default --no-install
rm -rf mobile/app
cp -R mobile-src/. mobile/     # Windows: skopiuj ręcznie zawartość folderu mobile-src do mobile
cd ..
pnpm install
cd apps/mobile
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill expo-crypto expo-haptics
cp .env.example .env           # wpisz adres IP komputera i klucz publiczny Supabase
npx expo start                 # zeskanuj kod QR w Expo Go
```

Telefon nie widzi „localhost” komputera — w `.env` aplikacji podaj adres IP komputera w sieci Wi-Fi (np. `http://192.168.1.20:3000` dla API i `http://192.168.1.20:54321` dla Supabase). Plik `.npmrc` (`node-linker=hoisted`) jest potrzebny, żeby Expo działało w monorepo pnpm.

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
- Vercel: import repozytorium, katalog `apps/web`, zmienne środowiskowe.
- Expo EAS Build → TestFlight i testy wewnętrzne Google Play. Przed publikacją: zakupy w aplikacji (RevenueCat), polityka prywatności, usuwanie konta w aplikacji, szyfrowany magazyn sesji.

## Zasady, których pilnuje kod

- Rekomendacje liczy deterministyczny silnik; AI tylko je opisuje, a tekst z liczbą spoza faktów zostaje odrzucony.
- Ciężar rośnie dopiero, gdy wszystkie serie osiągną górę zakresu z zapasem ≥ docelowy RIR; nadpisanie trenera zawsze wygrywa.
- Uprawnienia rozstrzyga serwer; zgubiony webhook nie daje darmowego dostępu, a nieudana płatność daje 7 dni okresu łaski.
- Serii nie da się podpiąć pod cudzą sesję; historię czatu, rekomendacje i płatności zapisuje wyłącznie serwer.
