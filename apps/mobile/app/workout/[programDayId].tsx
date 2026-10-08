import type { CompleteSessionRequest, CompleteSessionResponse, LoggedSetInput, PlayerExercise, PlayerPayload } from '@mp-power/core';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { RestTimer } from '../../src/components/RestTimer';
import { ReviewView } from '../../src/components/ReviewView';
import { SetRow, type SetDraft } from '../../src/components/SetRow';
import { apiFetch, messageForError } from '../../src/lib/api';
import { formatClock, formatInput, formatKg, formatRange, parseDecimal, seriesWord } from '../../src/lib/format';
import { clearWorkout, loadWorkout, saveWorkout } from '../../src/lib/workout-store';
import { colors, fonts, radius, space } from '../../src/theme/tokens';

type Drafts = Record<string, SetDraft[]>;
type Phase =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'active' }
  | { kind: 'submitting' }
  | { kind: 'review'; result: CompleteSessionResponse };

const unitFor = (ex: PlayerExercise): string => (ex.loadType === 'time' ? 's' : 'powt.');

/** Pola serii wypełnione celem z silnika progresji (ciężar i powtórzenia na każdą serię). */
function initialDrafts(payload: PlayerPayload): Drafts {
  const drafts: Drafts = {};
  for (const ex of payload.exercises) {
    const count = ex.target?.sets ?? ex.prescription.sets;
    const load = ex.loadType === 'external' && ex.target?.loadKg != null ? formatInput(ex.target.loadKg) : '';
    drafts[ex.sessionExerciseId] = Array.from({ length: count }, (_, i) => ({
      load,
      reps: String(ex.target?.repsPerSet[i] ?? ex.prescription.repMin),
      rir: null,
      done: false,
    }));
  }
  return drafts;
}

function describePrescription(ex: PlayerExercise): string {
  const p = ex.prescription;
  const parts = [`${p.sets} ${seriesWord(p.sets)} po ${formatRange(p.repMin, p.repMax)} ${unitFor(ex)}`, `zapas RIR ${p.targetRir}`];
  if (p.tempo) parts.push(`tempo ${p.tempo}`);
  parts.push(`przerwa ${formatClock(p.restSeconds)}`);
  return parts.join(', ');
}

function heroValue(ex: PlayerExercise): string | null {
  if (!ex.target) return null;
  if (ex.loadType === 'external' && ex.target.loadKg !== null) return formatKg(ex.target.loadKg);
  return `${formatRange(ex.target.repMin, ex.target.repMax)} ${unitFor(ex)}`;
}

/** Workout Player: serie zapisywane w telefonie, timer przerw, a na końcu AI Review z celami. */
export default function WorkoutPlayerScreen() {
  const params = useLocalSearchParams<{ programDayId: string }>();
  const programDayId = typeof params.programDayId === 'string' ? params.programDayId : '';
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = useState<PlayerPayload | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const clientSessionId = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (!programDayId) {
      setPhase({ kind: 'failed', message: 'Nie wybrano dnia treningowego.' });
      return;
    }
    setPhase({ kind: 'loading' });
    try {
      const saved = await loadWorkout(programDayId);
      if (saved) {
        clientSessionId.current = saved.clientSessionId;
        setPayload(saved.payload);
        setDrafts(saved.drafts);
        setIndex(Math.min(saved.index, Math.max(0, saved.payload.exercises.length - 1)));
        setPhase({ kind: 'active' });
        return;
      }
      clientSessionId.current = Crypto.randomUUID();
      const started = await apiFetch<PlayerPayload>('/api/v1/sessions', {
        method: 'POST',
        body: { programDayId, clientSessionId: clientSessionId.current },
      });
      setPayload(started);
      setDrafts(initialDrafts(started));
      setIndex(0);
      setPhase({ kind: 'active' });
    } catch (err) {
      setPhase({ kind: 'failed', message: messageForError(err) });
    }
  }, [programDayId]);

  useEffect(() => {
    void start();
  }, [start]);

  // Kopia treningu w telefonie po każdej zmianie — przetrwa zamknięcie aplikacji i brak zasięgu.
  useEffect(() => {
    if (payload && clientSessionId.current && phase.kind !== 'review') {
      void saveWorkout(programDayId, { clientSessionId: clientSessionId.current, payload, drafts, index });
    }
  }, [payload, drafts, index, phase.kind, programDayId]);

  const exercise = payload?.exercises[index];
  const exerciseDrafts = exercise ? drafts[exercise.sessionExerciseId] ?? [] : [];
  const isLast = payload ? index >= payload.exercises.length - 1 : true;
  const endRest = useCallback(() => setRest(null), []);

  const updateSet = (setIndex: number, next: SetDraft) => {
    if (!exercise) return;
    const id = exercise.sessionExerciseId;
    setDrafts((prev: Drafts) => ({ ...prev, [id]: (prev[id] ?? []).map((d, i) => (i === setIndex ? next : d)) }));
  };

  const toggleDone = (setIndex: number) => {
    const current = exerciseDrafts[setIndex];
    if (!exercise || !current) return;
    const done = !current.done;
    updateSet(setIndex, { ...current, done });
    if (done) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const seconds = exercise.prescription.restSeconds;
      const lastSetOfWorkout = isLast && setIndex === exerciseDrafts.length - 1;
      if (seconds > 0 && !lastSetOfWorkout) setRest({ endsAt: Date.now() + seconds * 1000, total: seconds });
    }
  };

  const addSet = () => {
    if (!exercise) return;
    const id = exercise.sessionExerciseId;
    setDrafts((prev: Drafts) => {
      const list = prev[id] ?? [];
      const last = list[list.length - 1];
      return { ...prev, [id]: [...list, { load: last?.load ?? '', reps: last?.reps ?? String(exercise.prescription.repMin), rir: null, done: false }] };
    });
  };

  const goTo = (nextIndex: number) => {
    setIndex(nextIndex);
    setShowWhy(false);
  };

  const buildRequest = (): { request: CompleteSessionRequest; bad: Set<string> } => {
    const sets: LoggedSetInput[] = [];
    const skipped: string[] = [];
    const bad = new Set<string>();
    for (const ex of payload?.exercises ?? []) {
      let logged = 0;
      (drafts[ex.sessionExerciseId] ?? []).forEach((d, i) => {
        if (!d.done) return;
        const reps = Number.parseInt(d.reps, 10);
        const loadKg = ex.loadType === 'external' ? parseDecimal(d.load) : null;
        if (!Number.isFinite(reps) || reps < 0 || (ex.loadType === 'external' && (loadKg === null || loadKg < 0))) {
          bad.add(`${ex.sessionExerciseId}:${i}`);
          return;
        }
        logged += 1;
        sets.push({ sessionExerciseId: ex.sessionExerciseId, setIndex: i + 1, loadKg, reps, rir: d.rir, completed: true });
      });
      if (logged === 0) skipped.push(ex.sessionExerciseId);
    }
    return { request: { sets, skippedSessionExerciseIds: skipped, completedAt: new Date().toISOString() }, bad };
  };

  const finish = async () => {
    if (!payload) return;
    const { request, bad } = buildRequest();
    setInvalid(bad);
    if (bad.size > 0) {
      setError('Uzupełnij ciężar i powtórzenia w zaznaczonych na czerwono seriach.');
      return;
    }
    if (request.sets.length === 0) {
      setError('Zapisz co najmniej jedną serię, żeby zakończyć trening.');
      return;
    }
    setError(null);
    setRest(null);
    setPhase({ kind: 'submitting' });
    try {
      const result = await apiFetch<CompleteSessionResponse>(`/api/v1/sessions/${payload.sessionId}/complete`, {
        method: 'POST',
        body: request,
      });
      await clearWorkout(programDayId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase({ kind: 'review', result });
    } catch (err) {
      setPhase({ kind: 'active' });
      setError(`${messageForError(err)} Twoje serie są zapisane w telefonie.`);
    }
  };

  const confirmFinish = () => {
    const pending = (payload?.exercises ?? []).some((ex) => (drafts[ex.sessionExerciseId] ?? []).some((d) => !d.done));
    if (!pending) {
      void finish();
      return;
    }
    Alert.alert('Zakończyć trening?', 'Część serii nie jest zapisana. Niezapisane serie nie trafią do historii.', [
      { text: 'Wróć do treningu', style: 'cancel' },
      { text: 'Zakończ trening', onPress: () => void finish() },
    ]);
  };

  const close = () => {
    Alert.alert('Wyjść z treningu?', 'Zapisane serie zostają w telefonie. Dokończysz trening z ekranu Dziś.', [
      { text: 'Zostań', style: 'cancel' },
      { text: 'Wyjdź', onPress: () => router.back() },
    ]);
  };

  if (phase.kind === 'review') {
    return <ReviewView result={phase.result} topInset={insets.top} bottomInset={insets.bottom} onDone={() => router.replace('/')} />;
  }

  if (phase.kind === 'loading' || (!exercise && phase.kind !== 'failed')) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.centerText}>Przygotowujemy trening…</Text>
      </View>
    );
  }

  if (phase.kind === 'failed' || !exercise || !payload) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.l }]}>
        <Text style={styles.centerTitle}>Nie udało się otworzyć treningu</Text>
        <Text style={styles.centerText}>{phase.kind === 'failed' ? phase.message : 'Brak ćwiczeń w tym dniu planu.'}</Text>
        <PrimaryButton label="Spróbuj ponownie" onPress={() => void start()} />
        <PrimaryButton label="Wróć" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const unit = unitFor(exercise);
  const hero = heroValue(exercise);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.s }]}>
        <Pressable onPress={close} hitSlop={8} style={styles.topAction} accessibilityRole="button" accessibilityLabel="Wyjdź z treningu">
          <Text style={styles.topActionText}>Wyjdź</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {payload.title ?? 'Trening'}
        </Text>
        <Text style={styles.counter} accessibilityLabel={`Ćwiczenie ${index + 1} z ${payload.exercises.length}`}>
          {index + 1}/{payload.exercises.length}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.exerciseName}>{exercise.name}</Text>
        <Text style={styles.prescription}>{describePrescription(exercise)}</Text>

        <View style={styles.hero}>
          {hero && exercise.target ? (
            <>
              <Text style={styles.heroValue}>{hero}</Text>
              <Text style={styles.heroCaption}>
                Cel na dziś: {exercise.target.repsPerSet.join('/')} {unit}
              </Text>
            </>
          ) : (
            <Text style={styles.heroCaptionStrong}>
              Pierwsze wykonanie. Dobierz ciężar tak, by w każdej serii zostało ok. {exercise.prescription.targetRir} powt. zapasu.
            </Text>
          )}
          {exercise.why ? (
            <Pressable onPress={() => setShowWhy((v: boolean) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showWhy }}>
              <Text style={showWhy ? styles.whyText : styles.whyLink}>{showWhy ? exercise.why : 'Dlaczego taki cel?'}</Text>
            </Pressable>
          ) : null}
        </View>

        {exercise.prescription.notes ? <Text style={styles.notes}>{exercise.prescription.notes}</Text> : null}

        <View style={styles.sets}>
          {exerciseDrafts.map((draft, i) => (
            <SetRow
              key={`${exercise.sessionExerciseId}-${i}`}
              index={i}
              draft={draft}
              showLoad={exercise.loadType === 'external'}
              unit={unit}
              invalid={invalid.has(`${exercise.sessionExerciseId}:${i}`)}
              onChange={(next: SetDraft) => updateSet(i, next)}
              onToggleDone={() => toggleDone(i)}
            />
          ))}
          <Pressable onPress={addSet} style={styles.addSet} accessibilityRole="button">
            <Text style={styles.addSetText}>Dodaj serię</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.s }]}>
        {rest ? (
          <RestTimer
            endsAt={rest.endsAt}
            total={rest.total}
            onDone={endRest}
            onSkip={endRest}
            onAdd={(seconds: number) => setRest((r) => (r ? { endsAt: r.endsAt + seconds * 1000, total: r.total + seconds } : r))}
          />
        ) : null}
        <View style={styles.nav}>
          <PrimaryButton label="Poprzednie" variant="secondary" onPress={() => goTo(Math.max(0, index - 1))} disabled={index === 0} grow />
          {isLast ? (
            <PrimaryButton label="Zakończ trening" onPress={confirmFinish} loading={phase.kind === 'submitting'} grow />
          ) : (
            <PrimaryButton label="Następne ćwiczenie" onPress={() => goTo(index + 1)} grow />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, backgroundColor: colors.bg },
  centerTitle: { color: colors.text, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  centerText: { color: colors.muted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingBottom: space.s },
  topAction: { minHeight: 44, justifyContent: 'center' },
  topActionText: { color: colors.muted, fontSize: 16 },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  counter: { color: colors.muted, fontSize: 16, fontVariant: ['tabular-nums'] },
  content: { paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m },
  exerciseName: { color: colors.text, fontFamily: fonts.display, fontSize: 34, fontWeight: '700', lineHeight: 38, marginTop: space.s },
  prescription: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  hero: { gap: space.xs, paddingVertical: space.s },
  heroValue: { color: colors.text, fontFamily: fonts.display, fontSize: 72, fontWeight: '700', lineHeight: 76, fontVariant: ['tabular-nums'] },
  heroCaption: { color: colors.text, fontSize: 17 },
  heroCaptionStrong: { color: colors.text, fontSize: 17, lineHeight: 24 },
  whyLink: { color: colors.accent, fontSize: 15, fontWeight: '600', paddingVertical: space.xs },
  whyText: { color: colors.muted, fontSize: 15, lineHeight: 22, paddingVertical: space.xs },
  notes: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  sets: { gap: space.s },
  addSet: { minHeight: 44, justifyContent: 'center' },
  addSetText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  error: { color: colors.text, backgroundColor: colors.surfaceRaised, borderLeftWidth: 3, borderLeftColor: colors.danger, padding: space.m, borderRadius: radius.control, fontSize: 15, lineHeight: 21 },
  bottom: { paddingHorizontal: space.l, paddingTop: space.s, gap: space.s, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line },
  nav: { flexDirection: 'row', gap: space.s },
});
