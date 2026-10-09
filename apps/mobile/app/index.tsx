import type { EntitlementsResponse, HomeDay, HomeResponse } from '@mp-power/core';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { apiFetch, messageForError } from '../src/lib/api';
import { capitalize } from '../src/lib/format';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/lib/use-session';
import { colors, fonts, radius, space } from '../src/theme/tokens';

/** Ekran „Dziś”: plan ogólny od pierwszego dnia, a po ankiecie i pomiarach — plan na cykl 8 tygodni. */
export default function TodayScreen() {
  const { session, ready } = useSession();
  const insets = useSafeAreaInsets();
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHome(await apiFetch<HomeResponse>('/api/v1/me/home'));
    } catch (err) {
      setError(`${messageForError(err)} Odśwież, gdy połączenie wróci.`);
      return;
    }
    apiFetch<EntitlementsResponse>('/api/v1/me/entitlements')
      .then((e: EntitlementsResponse) => setPlan(e.planCode.toUpperCase()))
      .catch(() => setPlan(null));
  }, []);

  // Odśwież po powrocie z ankiety lub treningu (tydzień cyklu, nowy plan).
  useFocusEffect(
    useCallback(() => {
      if (session) void load();
    }, [session, load]),
  );

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const program = home?.program ?? null;
  const days: HomeDay[] = program?.days ?? [];
  const [next, ...others] = days;
  const cycle = program?.cycle ?? null;
  const today = capitalize(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.l, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.header}>
        <Text style={styles.date}>{today}</Text>
        {plan ? <Text style={styles.plan}>Plan {plan}</Text> : null}
      </View>
      <Text style={styles.title}>Dziś</Text>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
          <PrimaryButton label="Odśwież" variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}

      {home === null && !error ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}

      {program?.kind === 'general' && home ? (
        <Pressable onPress={() => router.push('/onboarding')} style={({ pressed }: { pressed: boolean }) => [styles.profileCard, pressed && styles.rowPressed]} accessibilityRole="button" accessibilityLabel="Uzupełnij profil i pomiary">
          <Text style={styles.profileTitle}>{home.completeness.complete ? 'Wszystko gotowe do zaprojektowania planu' : 'Plan na 8 tygodni, dopasowany do Ciebie'}</Text>
          <Text style={styles.profileText}>
            {home.completeness.complete
              ? 'Masz komplet danych i pomiarów. Zaprojektuj plan, a zastąpi on trening ogólny.'
              : 'Uzupełnij cel, doświadczenie, dane i pomiary obwodów, a zaprojektujemy plan pod Ciebie. Do tego czasu trenujesz z planem ogólnym.'}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${home.completeness.percent}%` }]} />
          </View>
          <View style={styles.profileFoot}>
            <Text style={styles.profilePercent}>Profil {home.completeness.percent}%</Text>
            <Text style={styles.rowAction}>{home.completeness.complete ? 'Zaprojektuj plan' : home.completeness.percent > 0 ? 'Dokończ' : 'Zacznij'}</Text>
          </View>
        </Pressable>
      ) : null}

      {program ? (
        <View style={styles.programHead}>
          <Text style={styles.programKind}>{program.kind === 'general' ? 'Plan ogólny' : 'Twój plan'}</Text>
          <Text style={styles.programTitle}>{program.title}</Text>
          {cycle ? (
            <View style={styles.cycle}>
              <View style={styles.weeks} accessibilityLabel={`Tydzień ${cycle.week} z ${cycle.totalWeeks}`}>
                {Array.from({ length: cycle.totalWeeks }, (_, i) => (
                  <View key={i} style={[styles.weekPip, i + 1 < cycle.week && styles.weekDone, i + 1 === cycle.week && styles.weekNow]} />
                ))}
              </View>
              <Text style={styles.cycleLabel}>
                Tydzień {cycle.week} z {cycle.totalWeeks} · {cycle.label}
              </Text>
              {cycle.focus ? <Text style={styles.cycleFocus}>{cycle.focus}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {cycle?.checkIn ? (
        <Pressable onPress={() => router.push('/onboarding?step=measurements')} style={({ pressed }: { pressed: boolean }) => [styles.notice, pressed && styles.rowPressed]} accessibilityRole="button">
          <Text style={styles.noticeTitle}>Czas na pomiary kontrolne</Text>
          <Text style={styles.noticeText}>Zmierz obwody i zrób zdjęcia jak na starcie. Porównamy je z punktem wyjścia.</Text>
          <Text style={styles.rowAction}>Wpisz pomiary</Text>
        </Pressable>
      ) : null}

      {home && !program ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Nie masz jeszcze planu treningowego</Text>
          <Text style={styles.noticeText}>Uzupełnij profil, a zaprojektujemy plan pod Ciebie.</Text>
        </View>
      ) : null}

      {next ? (
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{next.title}</Text>
          {next.focus ? (
            <Text style={styles.heroFocus}>
              {capitalize(next.focus)}
              {next.estimatedMinutes ? `, około ${next.estimatedMinutes} min` : ''}
            </Text>
          ) : null}
          <PrimaryButton label="Zacznij trening" onPress={() => router.push(`/workout/${next.id}`)} />
        </View>
      ) : null}

      {others.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listTitle}>Pozostałe dni planu</Text>
          {others.map((day) => (
            <Pressable
              key={day.id}
              onPress={() => router.push(`/workout/${day.id}`)}
              style={({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Zacznij trening ${day.title}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{day.title}</Text>
                {day.focus ? <Text style={styles.rowFocus}>{capitalize(day.focus)}</Text> : null}
              </View>
              <Text style={styles.rowAction}>Zacznij</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {program?.kind === 'personal' ? (
        <Pressable onPress={() => router.push('/onboarding?step=summary')} style={styles.signOut} accessibilityRole="button">
          <Text style={styles.link}>Mój profil i pomiary</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOut} accessibilityRole="button">
        <Text style={styles.signOutText}>Wyloguj się</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { paddingHorizontal: space.l, gap: space.l },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { color: colors.muted, fontSize: 15 },
  plan: { color: colors.progress, fontSize: 14, fontWeight: '600' },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 56, fontWeight: '700', lineHeight: 60 },
  loader: { marginTop: space.xl },
  notice: { backgroundColor: colors.surface, borderRadius: radius.control, padding: space.m, gap: space.s },
  noticeTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  noticeText: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  hero: { backgroundColor: colors.surface, borderRadius: radius.sheet, padding: space.l, gap: space.m },
  heroTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 40, fontWeight: '700', lineHeight: 44 },
  heroFocus: { color: colors.muted, fontSize: 16, lineHeight: 22 },
  list: { gap: space.xs },
  listTitle: { color: colors.muted, fontSize: 15, fontWeight: '600', marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m, borderBottomWidth: 1, borderBottomColor: colors.line, gap: space.m },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  rowFocus: { color: colors.muted, fontSize: 14 },
  rowAction: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  signOut: { minHeight: 44, justifyContent: 'center' },
  link: { color: colors.text, fontSize: 15, fontWeight: '600' },
  profileCard: { backgroundColor: colors.surface, borderRadius: radius.sheet, padding: space.l, gap: space.s, borderWidth: 1, borderColor: colors.progress },
  profileTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 24, fontWeight: '700', lineHeight: 28 },
  profileText: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  profileFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profilePercent: { color: colors.progress, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden', marginTop: space.xs },
  progressFill: { height: 6, backgroundColor: colors.progress },
  programHead: { gap: space.xs },
  programKind: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  programTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  cycle: { gap: space.xs, marginTop: space.s },
  weeks: { flexDirection: 'row', gap: 4 },
  weekPip: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised },
  weekDone: { backgroundColor: colors.progress },
  weekNow: { backgroundColor: colors.accent },
  cycleLabel: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cycleFocus: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  signOutText: { color: colors.muted, fontSize: 15 },
});
