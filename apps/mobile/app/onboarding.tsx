import {
  CIRCUMFERENCE_LABELS,
  PROFILE_LIMITS,
  profileCompleteness,
  type CircumferenceKind,
  type GeneratePlanResponse,
  type HomeResponse,
  type Limitation,
  type OnboardingProfile,
  type PhotoPose,
  type ProfileResponse,
  type UpdateProfileRequest,
} from '@mp-power/core';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Checkbox, ChipRow, OptionList } from '../src/components/Choice';
import { NumberField } from '../src/components/NumberField';
import { PlanView } from '../src/components/PlanView';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { apiFetch, messageForError } from '../src/lib/api';
import { formatInput, parseDecimal } from '../src/lib/format';
import { uploadProgressPhoto } from '../src/lib/photos';
import { colors, fonts, radius, space } from '../src/theme/tokens';

const STEPS = ['goal', 'level', 'body', 'training', 'measurements', 'photos', 'summary'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  goal: 'Co chcesz osiągnąć?',
  level: 'Jakie masz doświadczenie z treningiem siłowym?',
  body: 'Twoje dane',
  training: 'Jak chcesz trenować?',
  measurements: 'Pomiary obwodów',
  photos: 'Zdjęcia sylwetki',
  summary: 'Projektujemy Twój plan',
};

const MEASUREMENT_HINTS: Record<CircumferenceKind, string> = {
  waist: 'Najwęższe miejsce tułowia, zwykle nad pępkiem. Mierz na spokojnym wydechu.',
  abdomen: 'Na wysokości pępka, brzuch rozluźniony.',
  chest: 'Przez najszerszy punkt klatki, pod pachami, ręce opuszczone.',
  arm: 'Najszerszy punkt ramienia, ręka swobodnie opuszczona.',
  thigh: 'Najszerszy punkt uda, ok. 5 cm pod pośladkiem.',
  hips: 'Najszerszy punkt pośladków, stopy razem.',
};
const MEASUREMENT_ORDER: CircumferenceKind[] = ['waist', 'abdomen', 'chest', 'arm', 'thigh', 'hips'];

const POSES: Array<{ pose: PhotoPose; label: string }> = [
  { pose: 'front', label: 'Przód' },
  { pose: 'side', label: 'Bok' },
  { pose: 'back', label: 'Tył' },
];

const LIMITATIONS: Array<{ value: Limitation; label: string }> = [
  { value: 'knee', label: 'Kolano' },
  { value: 'shoulder', label: 'Bark' },
  { value: 'lower_back', label: 'Dolny odcinek pleców' },
  { value: 'wrist', label: 'Nadgarstek' },
];

type LocationChoice = 'gym' | 'home_dumbbells' | 'home_none';

/** Pola liczbowe trzymamy jako tekst (to, co wpisał użytkownik), a liczby wyliczamy przy zapisie. */
interface Drafts {
  birthYear: string;
  heightCm: string;
  weightKg: string;
  circumferences: Record<CircumferenceKind, string>;
}

const str = (v: number | null | undefined) => (v == null ? '' : formatInput(v));

function draftsFrom(p: OnboardingProfile): Drafts {
  const c = p.circumferences ?? {};
  return {
    birthYear: p.birthYear ? String(p.birthYear) : '',
    heightCm: str(p.heightCm),
    weightKg: str(p.weightKg),
    circumferences: { waist: str(c.waist), abdomen: str(c.abdomen), chest: str(c.chest), arm: str(c.arm), thigh: str(c.thigh), hips: str(c.hips) },
  };
}

const inRange = (v: number | null, [min, max]: readonly [number, number]) => v !== null && v >= min && v <= max;

function firstIncompleteStep(p: OnboardingProfile): Step {
  const missing = profileCompleteness(p).missing;
  if (missing.includes('goal')) return 'goal';
  if (missing.includes('level')) return 'level';
  if (missing.some((m) => ['sex', 'birthYear', 'heightCm', 'weightKg'].includes(m))) return 'body';
  if (missing.some((m) => ['daysPerWeek', 'location'].includes(m))) return 'training';
  if (missing.some((m) => m.startsWith('circumference.'))) return 'measurements';
  return 'summary';
}

/** Ankieta startowa: cel, doświadczenie, dane, trening, obwody, zdjęcia → plan na 8 tygodni. Każdy krok zapisuje się od razu. */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ step?: string }>();
  const [loaded, setLoaded] = useState<ProfileResponse | null>(null);
  const [profile, setProfile] = useState<OnboardingProfile>({});
  const [drafts, setDrafts] = useState<Drafts>(draftsFrom({}));
  const [consents, setConsents] = useState({ healthData: false, bodyImages: false });
  const [photos, setPhotos] = useState<Partial<Record<PhotoPose, string>>>({});
  const [step, setStep] = useState<Step>('goal');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<PhotoPose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [result, setResult] = useState<GeneratePlanResponse | null>(null);
  const [hasPersonalPlan, setHasPersonalPlan] = useState(false);

  const applyResponse = (r: ProfileResponse) => {
    setLoaded(r);
    setProfile(r.profile);
    setConsents(r.consents);
    const latest: Partial<Record<PhotoPose, string>> = {};
    for (const p of r.photos) if (p.url && !latest[p.pose]) latest[p.pose] = p.url;
    setPhotos((prev: Partial<Record<PhotoPose, string>>) => ({ ...latest, ...prev }));
  };

  useEffect(() => {
    apiFetch<HomeResponse>('/api/v1/me/home')
      .then((h: HomeResponse) => setHasPersonalPlan(h.program?.kind === 'personal'))
      .catch(() => setHasPersonalPlan(false));
    apiFetch<ProfileResponse>('/api/v1/me/profile')
      .then((r: ProfileResponse) => {
        applyResponse(r);
        setDrafts(draftsFrom(r.profile));
        const requested = STEPS.find((s) => s === params.step);
        setStep(requested ?? firstIncompleteStep(r.profile));
      })
      .catch((err: unknown) => setError(messageForError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const numbers = useMemo(() => {
    const circumferences: Partial<Record<CircumferenceKind, number | null>> = {};
    for (const k of MEASUREMENT_ORDER) circumferences[k] = parseDecimal(drafts.circumferences[k]);
    const birthYear = /^\d{4}$/.test(drafts.birthYear.trim()) ? Number(drafts.birthYear) : null;
    return { birthYear, heightCm: parseDecimal(drafts.heightCm), weightKg: parseDecimal(drafts.weightKg), circumferences };
  }, [drafts]);

  // Komunikat znika, gdy użytkownik zaczyna poprawiać dane.
  useEffect(() => {
    setError(null);
  }, [drafts, profile.goal, profile.level, profile.sex, profile.daysPerWeek, profile.sessionMinutes, profile.location, profile.homeEquipment, profile.limitations, consents.healthData]);

  const thisYear = new Date().getFullYear();
  const fieldErrors = {
    birthYear: inRange(numbers.birthYear, [thisYear - 100, thisYear - 18]) ? null : 'Podaj rok urodzenia (aplikacja jest dla osób pełnoletnich).',
    heightCm: inRange(numbers.heightCm, PROFILE_LIMITS.heightCm) ? null : `Wzrost w cm, od ${PROFILE_LIMITS.heightCm[0]} do ${PROFILE_LIMITS.heightCm[1]}.`,
    weightKg: inRange(numbers.weightKg, PROFILE_LIMITS.weightKg) ? null : `Masa ciała w kg, od ${PROFILE_LIMITS.weightKg[0]} do ${PROFILE_LIMITS.weightKg[1]}.`,
    circumference: (k: CircumferenceKind) => {
      const v = numbers.circumferences[k] ?? null;
      if (k === 'hips' && drafts.circumferences.hips.trim() === '') return null;
      return inRange(v, PROFILE_LIMITS.circumference) ? null : `Wpisz obwód w cm (${PROFILE_LIMITS.circumference[0]}–${PROFILE_LIMITS.circumference[1]}).`;
    },
  };

  const locationChoice: LocationChoice | null =
    profile.location === 'gym' ? 'gym' : profile.location === 'home' ? (profile.homeEquipment === 'dumbbells' ? 'home_dumbbells' : profile.homeEquipment === 'none' ? 'home_none' : null) : null;
  const limitations = profile.limitations ?? [];

  /** Co wysłać i czy krok jest kompletny. */
  const stepPayload = (s: Step): { body: UpdateProfileRequest | null; valid: boolean } => {
    switch (s) {
      case 'goal':
        return { body: { goal: profile.goal ?? undefined }, valid: !!profile.goal };
      case 'level':
        return { body: { level: profile.level ?? undefined }, valid: !!profile.level };
      case 'body': {
        const valid = !!profile.sex && !fieldErrors.birthYear && !fieldErrors.heightCm && !fieldErrors.weightKg;
        return { body: { sex: profile.sex ?? undefined, birthYear: numbers.birthYear!, heightCm: numbers.heightCm!, weightKg: numbers.weightKg! }, valid };
      }
      case 'training': {
        const valid = !!profile.daysPerWeek && !!profile.sessionMinutes && !!locationChoice && (limitations.length === 0 || consents.healthData);
        return {
          body: {
            daysPerWeek: profile.daysPerWeek ?? undefined,
            sessionMinutes: profile.sessionMinutes ?? undefined,
            location: profile.location ?? undefined,
            homeEquipment: profile.location === 'home' ? profile.homeEquipment ?? undefined : undefined,
            limitations,
            consents: { healthData: consents.healthData },
          },
          valid,
        };
      }
      case 'measurements': {
        const valid = MEASUREMENT_ORDER.every((k) => !fieldErrors.circumference(k));
        const circumferences: Partial<Record<CircumferenceKind, number>> = {};
        for (const k of MEASUREMENT_ORDER) {
          const v = numbers.circumferences[k];
          if (v != null) circumferences[k] = v;
        }
        return { body: { circumferences }, valid };
      }
      default:
        return { body: null, valid: true };
    }
  };

  const index = STEPS.indexOf(step);
  const goTo = (s: Step) => {
    setShowErrors(false);
    setError(null);
    setStep(s);
  };

  const next = async () => {
    const { body, valid } = stepPayload(step);
    if (!valid) {
      setShowErrors(true);
      setError(step === 'training' && limitations.length > 0 && !consents.healthData
        ? 'Zaznacz zgodę na przetwarzanie danych o zdrowiu albo odznacz kontuzje.'
        : 'Uzupełnij zaznaczone pola, żeby przejść dalej.');
      return;
    }
    setBusy(true);
    try {
      if (body) applyResponse(await apiFetch<ProfileResponse>('/api/v1/me/profile', { method: 'PUT', body }));
      goTo(STEPS[Math.min(STEPS.length - 1, index + 1)]!);
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  const setBodyImagesConsent = async (granted: boolean) => {
    setBusy(true);
    try {
      applyResponse(await apiFetch<ProfileResponse>('/api/v1/me/profile', { method: 'PUT', body: { consents: { bodyImages: granted } } }));
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async (pose: PhotoPose, source: 'camera' | 'library') => {
    setError(null);
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === 'camera' ? 'Zezwól na dostęp do aparatu w ustawieniach telefonu.' : 'Zezwól na dostęp do zdjęć w ustawieniach telefonu.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setUploading(pose);
    try {
      await uploadProgressPhoto(pose, asset.uri, asset.mimeType ?? 'image/jpeg');
      setPhotos((prev: Partial<Record<PhotoPose, string>>) => ({ ...prev, [pose]: asset.uri }));
    } catch {
      setError('Nie udało się zapisać zdjęcia. Sprawdź połączenie i spróbuj ponownie.');
    } finally {
      setUploading(null);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiFetch<GeneratePlanResponse>('/api/v1/programs/generate', { method: 'POST' }));
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <View style={styles.screen}>
        <PlanView result={result} topInset={insets.top} bottomInset={insets.bottom} onDone={() => router.replace('/')} />
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        {error ? (
          <View style={styles.centerBox}>
            <Text style={styles.error}>{error}</Text>
            <PrimaryButton label="Wróć" variant="secondary" onPress={() => router.replace('/')} />
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  const completeness = profileCompleteness(profile);
  const update = (patch: Partial<OnboardingProfile>) => setProfile((prev: OnboardingProfile) => ({ ...prev, ...patch }));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + space.s }]}>
        <Pressable onPress={() => router.replace('/')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dokończ później">
          <Text style={styles.topAction}>Dokończ później</Text>
        </Pressable>
        <Text style={styles.counter}>Krok {index + 1} z {STEPS.length}</Text>
      </View>
      <View style={styles.progressTrack} accessibilityLabel={`Postęp ankiety: krok ${index + 1} z ${STEPS.length}`}>
        <View style={[styles.progressFill, { width: `${((index + 1) / STEPS.length) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{STEP_TITLES[step]}</Text>

        {step === 'goal' ? (
          <OptionList
            value={profile.goal}
            onChange={(goal) => update({ goal })}
            options={[
              { value: 'fat_loss', label: 'Schudnąć', description: 'Mniej tkanki tłuszczowej, mięśnie zostają.' },
              { value: 'muscle_gain', label: 'Zbudować mięśnie', description: 'Więcej masy mięśniowej i lepsza sylwetka.' },
              { value: 'strength', label: 'Być silniejszym', description: 'Większe ciężary w podstawowych ćwiczeniach.' },
              { value: 'fitness', label: 'Poprawić kondycję i zdrowie', description: 'Więcej energii, sprawności i wydolności.' },
            ]}
          />
        ) : null}

        {step === 'level' ? (
          <OptionList
            value={profile.level}
            onChange={(level) => update({ level })}
            options={[
              { value: 'beginner', label: 'Zaczynam', description: 'Mniej niż 6 miesięcy regularnych treningów albo długa przerwa.' },
              { value: 'intermediate', label: 'Trenuję regularnie', description: 'Od 6 miesięcy do 2 lat, znam podstawowe ćwiczenia.' },
              { value: 'advanced', label: 'Trenuję od lat', description: 'Ponad 2 lata systematycznego treningu, pewna technika.' },
            ]}
          />
        ) : null}

        {step === 'body' ? (
          <View style={styles.group}>
            <Text style={styles.lead}>Na tej podstawie liczymy zapotrzebowanie kaloryczne i dobieramy objętość treningu.</Text>
            <Text style={styles.label}>Płeć</Text>
            <ChipRow
              label="Płeć"
              selected={profile.sex ? [profile.sex] : []}
              onToggle={(sex) => update({ sex })}
              options={[
                { value: 'female', label: 'Kobieta' },
                { value: 'male', label: 'Mężczyzna' },
                { value: 'unspecified', label: 'Nie podaję' },
              ]}
            />
            {showErrors && !profile.sex ? <Text style={styles.fieldError}>Wybierz jedną z opcji.</Text> : null}
            <View>
              <NumberField label="Rok urodzenia" unit="" integer value={drafts.birthYear} onChange={(birthYear) => setDrafts({ ...drafts, birthYear })} error={showErrors ? fieldErrors.birthYear : null} />
              <NumberField label="Wzrost" unit="cm" value={drafts.heightCm} onChange={(heightCm) => setDrafts({ ...drafts, heightCm })} error={showErrors ? fieldErrors.heightCm : null} />
              <NumberField label="Masa ciała" unit="kg" value={drafts.weightKg} onChange={(weightKg) => setDrafts({ ...drafts, weightKg })} hint="Rano, po toalecie, przed śniadaniem." error={showErrors ? fieldErrors.weightKg : null} />
            </View>
          </View>
        ) : null}

        {step === 'training' ? (
          <View style={styles.group}>
            <Text style={styles.label}>Ile dni w tygodniu?</Text>
            <ChipRow label="Dni w tygodniu" selected={profile.daysPerWeek ? [profile.daysPerWeek] : []} onToggle={(daysPerWeek) => update({ daysPerWeek })} options={[2, 3, 4, 5, 6].map((d) => ({ value: d, label: String(d) }))} />
            <Text style={styles.label}>Ile czasu na trening?</Text>
            <ChipRow label="Długość treningu" selected={profile.sessionMinutes ? [profile.sessionMinutes] : []} onToggle={(sessionMinutes) => update({ sessionMinutes })} options={[30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m} min` }))} />
            <Text style={styles.label}>Gdzie trenujesz?</Text>
            <OptionList<LocationChoice>
              value={locationChoice}
              onChange={(v) => update(v === 'gym' ? { location: 'gym', homeEquipment: null } : { location: 'home', homeEquipment: v === 'home_dumbbells' ? 'dumbbells' : 'none' })}
              options={[
                { value: 'gym', label: 'Siłownia', description: 'Sztangi, hantle, maszyny i wyciągi.' },
                { value: 'home_dumbbells', label: 'W domu, mam hantle', description: 'Hantle, mata, ewentualnie ławka.' },
                { value: 'home_none', label: 'W domu, bez sprzętu', description: 'Ćwiczenia z masą ciała.' },
              ]}
            />
            <Text style={styles.label}>Kontuzje lub ból przy ćwiczeniach</Text>
            <Text style={styles.hint}>Pominiemy ćwiczenia, które obciążają te miejsca. Zostaw puste, jeśli nic Ci nie dolega.</Text>
            <ChipRow
              label="Ograniczenia"
              selected={limitations}
              onToggle={(v) => update({ limitations: limitations.includes(v) ? limitations.filter((l) => l !== v) : [...limitations, v] })}
              options={LIMITATIONS}
            />
            {limitations.length > 0 ? (
              <Checkbox
                checked={consents.healthData}
                onToggle={() => setConsents({ ...consents, healthData: !consents.healthData })}
                label="Zgadzam się na przetwarzanie informacji o moim zdrowiu (kontuzje) w celu dopasowania planu."
              />
            ) : null}
            {showErrors && (!profile.daysPerWeek || !profile.sessionMinutes || !locationChoice) ? <Text style={styles.fieldError}>Wybierz liczbę dni, długość treningu i miejsce.</Text> : null}
          </View>
        ) : null}

        {step === 'measurements' ? (
          <View style={styles.group}>
            <Text style={styles.lead}>
              Bez obwodów nie zaprojektujemy planu pod Ciebie: to punkt startowy, z którym porównamy wyniki w 4. i 8. tygodniu. Mierz rano, miękką taśmą przylegającą do skóry, bez ściskania.
            </Text>
            <View>
              {MEASUREMENT_ORDER.map((k) => (
                <NumberField
                  key={k}
                  label={CIRCUMFERENCE_LABELS[k][0]!.toUpperCase() + CIRCUMFERENCE_LABELS[k].slice(1)}
                  unit="cm"
                  optional={k === 'hips'}
                  hint={MEASUREMENT_HINTS[k]}
                  value={drafts.circumferences[k]}
                  onChange={(v) => setDrafts({ ...drafts, circumferences: { ...drafts.circumferences, [k]: v } })}
                  error={showErrors ? fieldErrors.circumference(k) : null}
                />
              ))}
            </View>
          </View>
        ) : null}

        {step === 'photos' ? (
          <View style={styles.group}>
            <Text style={styles.lead}>
              Zdjęcia pokazują zmiany, których nie widać w centymetrach. Rób je w tym samym świetle, w dopasowanym stroju, o tej samej porze. Ten krok jest opcjonalny.
            </Text>
            <Checkbox
              checked={consents.bodyImages}
              onToggle={() => void setBodyImagesConsent(!consents.bodyImages)}
              label="Zgadzam się na przechowywanie moich zdjęć sylwetki. Widzę je tylko ja; mogę je usunąć w każdej chwili."
            />
            <View style={styles.photos}>
              {POSES.map(({ pose, label }) => (
                <View key={pose} style={styles.photoSlot}>
                  <View style={styles.photoFrame}>
                    {photos[pose] ? (
                      <Image source={{ uri: photos[pose] }} style={styles.photo} accessibilityLabel={`Zdjęcie: ${label}`} />
                    ) : uploading === pose ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      <Text style={styles.photoPlaceholder}>{label}</Text>
                    )}
                  </View>
                  {Platform.OS !== 'web' ? (
                    <Pressable disabled={!consents.bodyImages || uploading !== null} onPress={() => void takePhoto(pose, 'camera')} style={[styles.photoButton, !consents.bodyImages && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Zrób zdjęcie: ${label}`}>
                      <Text style={styles.photoButtonText}>Aparat</Text>
                    </Pressable>
                  ) : null}
                  <Pressable disabled={!consents.bodyImages || uploading !== null} onPress={() => void takePhoto(pose, 'library')} style={[styles.photoButton, !consents.bodyImages && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Wybierz zdjęcie: ${label}`}>
                    <Text style={styles.photoButtonText}>{Platform.OS === 'web' ? 'Wybierz' : 'Galeria'}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {step === 'summary' ? (
          <View style={styles.group}>
            {completeness.complete ? (
              <>
                <Text style={styles.lead}>
                  {hasPersonalPlan
                    ? 'Zmiana celu, danych albo pomiarów? Zaprojektujemy nowy plan na 8 tygodni. Obecny cykl się zakończy, a historia treningów zostanie.'
                    : 'Mamy wszystko, czego potrzebujemy. Zaprojektujemy plan na 8 tygodni: dobór ćwiczeń, serie, powtórzenia i zapas sił na każdy tydzień, z odciążeniem w 4. i 8. tygodniu.'}
                </Text>
                <SummaryRow label="Cel" value={GOAL_LABELS[profile.goal!]} onEdit={() => goTo('goal')} />
                <SummaryRow label="Doświadczenie" value={LEVEL_LABELS[profile.level!]} onEdit={() => goTo('level')} />
                <SummaryRow label="Dane" value={`${profile.heightCm} cm, ${formatInput(profile.weightKg!)} kg, rocznik ${profile.birthYear}`} onEdit={() => goTo('body')} />
                <SummaryRow
                  label="Trening"
                  value={`${profile.daysPerWeek}× w tygodniu po ${profile.sessionMinutes ?? 60} min, ${profile.location === 'gym' ? 'siłownia' : profile.homeEquipment === 'dumbbells' ? 'dom z hantlami' : 'dom bez sprzętu'}`}
                  onEdit={() => goTo('training')}
                />
                <SummaryRow
                  label="Obwody"
                  value={MEASUREMENT_ORDER.filter((k) => profile.circumferences?.[k]).map((k) => `${CIRCUMFERENCE_LABELS[k]} ${formatInput(profile.circumferences![k]!)}`).join(', ')}
                  onEdit={() => goTo('measurements')}
                />
                <SummaryRow label="Zdjęcia" value={Object.keys(photos).length ? `${Object.keys(photos).length} z 3` : 'pominięte'} onEdit={() => goTo('photos')} />
              </>
            ) : (
              <>
                <Text style={styles.lead}>Do zaprojektowania planu brakuje jeszcze kilku informacji. Do tego czasu możesz trenować z planem ogólnym.</Text>
                <PrimaryButton label="Uzupełnij brakujące dane" variant="secondary" onPress={() => goTo(firstIncompleteStep(profile))} />
              </>
            )}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.m }]}>
        {index > 0 ? <PrimaryButton label="Wstecz" variant="secondary" onPress={() => goTo(STEPS[index - 1]!)} grow /> : null}
        {step === 'summary' ? (
          <PrimaryButton label={hasPersonalPlan ? 'Zaprojektuj nowy plan' : 'Zaprojektuj mój plan'} onPress={() => void generate()} loading={busy} disabled={!completeness.complete} grow />
        ) : (
          <PrimaryButton label={step === 'photos' && Object.keys(photos).length === 0 ? 'Pomiń' : 'Dalej'} onPress={() => void next()} loading={busy} grow />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const GOAL_LABELS = { fat_loss: 'Schudnąć', muscle_gain: 'Zbudować mięśnie', strength: 'Być silniejszym', fitness: 'Poprawić kondycję i zdrowie' } as const;
const LEVEL_LABELS = { beginner: 'Zaczynam', intermediate: 'Trenuję regularnie', advanced: 'Trenuję od lat' } as const;

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <Pressable onPress={onEdit} style={styles.summaryRow} accessibilityRole="button" accessibilityLabel={`Zmień: ${label}`}>
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Text style={styles.summaryEdit}>Zmień</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerBox: { gap: space.m, padding: space.l, alignSelf: 'stretch' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.l, paddingBottom: space.s },
  topAction: { color: colors.muted, fontSize: 15 },
  counter: { color: colors.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 4, backgroundColor: colors.surface, marginHorizontal: space.l, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.progress },
  content: { padding: space.l, gap: space.l },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 34, fontWeight: '700', lineHeight: 38 },
  group: { gap: space.m },
  lead: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  label: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: space.s },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: -space.s },
  fieldError: { color: colors.danger, fontSize: 13 },
  error: { color: colors.text, backgroundColor: colors.surfaceRaised, padding: space.m, borderRadius: radius.control, fontSize: 15, lineHeight: 21, borderLeftWidth: 3, borderLeftColor: colors.danger },
  photos: { flexDirection: 'row', gap: space.s },
  photoSlot: { flex: 1, minWidth: 0, gap: space.xs },
  photoFrame: { aspectRatio: 3 / 4, borderRadius: radius.control, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  photoButton: { minHeight: 40, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  photoButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: colors.line },
  summaryText: { flex: 1, minWidth: 0, gap: 2 },
  summaryLabel: { color: colors.muted, fontSize: 13 },
  summaryValue: { color: colors.text, fontSize: 16, lineHeight: 22 },
  summaryEdit: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  bottom: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg },
});
