import type { EntitlementsResponse } from '@mp-power/core';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { apiFetch } from '../src/lib/api';
import { capitalize } from '../src/lib/format';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/lib/use-session';
import { colors, fonts, radius, space } from '../src/theme/tokens';

interface DayRow {
  id: string;
  title: string;
  focus: string | null;
  estimated_minutes: number | null;
  day_index: number;
}

/** Ekran „Dziś” (wersja startowa): dni planu widoczne dla planu użytkownika (RLS) i start treningu. */
export default function TodayScreen() {
  const { session, ready } = useSession();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('program_days')
      .select('id, title, focus, estimated_minutes, day_index')
      .order('day_index');
    if (queryError) {
      setError('Nie udało się pobrać planu. Sprawdź połączenie i odśwież.');
      return;
    }
    setDays((data ?? []) as DayRow[]);
    apiFetch<EntitlementsResponse>('/api/v1/me/entitlements')
      .then((e: EntitlementsResponse) => setPlan(e.planCode.toUpperCase()))
      .catch(() => setPlan(null));
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const [next, ...others] = days ?? [];
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

      {days === null && !error ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}

      {days !== null && days.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Nie masz jeszcze planu treningowego</Text>
          <Text style={styles.noticeText}>W wersji deweloperskiej wczytaj program testowy poleceniem supabase db reset.</Text>
        </View>
      ) : null}

      {next ? (
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{next.title}</Text>
          {next.focus ? (
            <Text style={styles.heroFocus}>
              {capitalize(next.focus)}
              {next.estimated_minutes ? `, około ${next.estimated_minutes} min` : ''}
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
  signOut: { minHeight: 44, justifyContent: 'center', marginTop: space.l },
  signOutText: { color: colors.muted, fontSize: 15 },
});
