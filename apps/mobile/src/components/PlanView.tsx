import type { CyclePhase, GeneratePlanResponse } from '@mp-power/core';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatRange } from '../lib/format';
import { colors, fonts, radius, space } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';

const PHASE_COLORS: Record<CyclePhase, string> = {
  intro: colors.line,
  build: colors.progress,
  peak: colors.accent,
  deload: colors.surfaceRaised,
};

interface Props {
  result: GeneratePlanResponse;
  topInset: number;
  bottomInset: number;
  onDone: () => void;
}

/** Zaprojektowany plan: uzasadnienie, 8 tygodni cyklu, dni z ćwiczeniami i orientacyjne cele żywieniowe. */
export function PlanView({ result, topInset, bottomInset, onDone }: Props) {
  const { program, nutrition } = result;
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset + space.l, paddingBottom: bottomInset + space.xl }]}>
      <Text style={styles.eyebrow}>Twój plan jest gotowy</Text>
      <Text style={styles.title}>{program.title}</Text>

      <View style={styles.insights}>
        {program.insights.map((text) => (
          <Text key={text} style={styles.insight}>
            {text}
          </Text>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>8 tygodni cyklu</Text>
        <View style={styles.timeline} accessibilityLabel="Fazy cyklu">
          {program.weeks.map((w) => (
            <View key={w.weekIndex} style={styles.weekCol}>
              <View style={[styles.weekBar, { backgroundColor: PHASE_COLORS[w.phase], height: w.phase === 'deload' ? 18 : w.phase === 'intro' ? 26 : w.phase === 'peak' ? 44 : 34 }]} />
              <Text style={styles.weekNo}>{w.weekIndex}</Text>
            </View>
          ))}
        </View>
        {program.weeks
          .filter((w, i, all) => i === 0 || all[i - 1]!.label !== w.label)
          .map((w) => {
            const last = [...program.weeks].reverse().find((x) => x.label === w.label)!;
            const range = last.weekIndex === w.weekIndex ? `Tydzień ${w.weekIndex}` : `Tygodnie ${w.weekIndex}–${last.weekIndex}`;
            return (
              <View key={w.weekIndex} style={styles.phaseRow}>
                <View style={[styles.phaseDot, { backgroundColor: PHASE_COLORS[w.phase] }]} />
                <View style={styles.phaseText}>
                  <Text style={styles.phaseLabel}>
                    {range} · {w.label}
                  </Text>
                  <Text style={styles.phaseFocus}>{w.focus}</Text>
                </View>
              </View>
            );
          })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Treningi w tygodniu</Text>
        {program.days.map((day) => (
          <View key={day.dayIndex} style={styles.day}>
            <View style={styles.dayHead}>
              <Text style={styles.dayTitle}>{day.title}</Text>
              <Text style={styles.dayMinutes}>ok. {day.estimatedMinutes} min</Text>
            </View>
            {day.exercises.map((e) => (
              <View key={e.exerciseId} style={styles.exercise}>
                <Text style={styles.exerciseName} numberOfLines={2}>
                  {e.name}
                </Text>
                <Text style={styles.exerciseDose}>
                  {e.sets}×{formatRange(e.repMin, e.repMax)}
                  {e.loadType === 'time' ? ' s' : ''}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      {nutrition ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Orientacyjnie na co dzień</Text>
          <View style={styles.stats}>
            <Stat value={String(nutrition.caloriesKcal)} unit="kcal" />
            <Stat value={String(nutrition.proteinG)} unit="g białka" />
            <Stat value={String(nutrition.carbsG)} unit="g węglowodanów" />
            <Stat value={String(nutrition.fatG)} unit="g tłuszczu" />
          </View>
          <Text style={styles.note}>Wartości startowe. Skorygujemy je po 2–3 tygodniach na podstawie masy ciała i obwodów.</Text>
        </View>
      ) : null}

      <PrimaryButton label="Przejdź do treningu" onPress={onDone} />
    </ScrollView>
  );
}

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.l, gap: space.l },
  eyebrow: { color: colors.progress, fontSize: 14, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 38, fontWeight: '700', lineHeight: 42, marginTop: -space.m },
  insights: { gap: space.s },
  insight: { color: colors.text, fontSize: 15, lineHeight: 22, paddingLeft: space.m, borderLeftWidth: 2, borderLeftColor: colors.line },
  section: { gap: space.m },
  sectionTitle: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  timeline: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 66 },
  weekCol: { flex: 1, alignItems: 'center', gap: 4 },
  weekBar: { alignSelf: 'stretch', borderRadius: 4 },
  weekNo: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  phaseRow: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start' },
  phaseDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  phaseText: { flex: 1, minWidth: 0, gap: 2 },
  phaseLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  phaseFocus: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  day: { backgroundColor: colors.surface, borderRadius: radius.control, padding: space.m, gap: space.s },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.xs },
  dayTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 22, fontWeight: '700' },
  dayMinutes: { color: colors.muted, fontSize: 14 },
  exercise: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  exerciseName: { color: colors.text, fontSize: 15, flex: 1, minWidth: 0 },
  exerciseDose: { color: colors.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: radius.control, padding: space.m, gap: 2 },
  statValue: { color: colors.text, fontFamily: fonts.display, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statUnit: { color: colors.muted, fontSize: 13 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
