import type { CompleteSessionResponse, ReviewRecord, ReviewTarget } from '@mp-power/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatKg, formatRange } from '../lib/format';
import { colors, fonts, radius, space } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';

function describeRecord(r: ReviewRecord): string {
  switch (r.kind) {
    case 'heaviest_load':
      return r.improvement !== null ? `${formatKg(r.value)} (+${formatKg(r.improvement)})` : formatKg(r.value);
    case 'best_e1rm':
      return `szacowany 1RM ${formatKg(r.value)}`;
    case 'most_reps':
      return `${r.value} powt.`;
    case 'longest_hold':
      return `${r.value} s`;
  }
}

function describeTarget(t: ReviewTarget): string {
  if (t.action === 'progress_variant') return 'trudniejszy wariant';
  const unit = t.loadType === 'time' ? 's' : 'powt.';
  if (t.next.loadKg !== null) return `${formatKg(t.next.loadKg)} × ${formatRange(t.next.repMin, t.next.repMax)}`;
  return `${t.next.repsPerSet.join('/')} ${unit}`;
}

interface Props {
  result: CompleteSessionResponse;
  topInset: number;
  bottomInset: number;
  onDone: () => void;
}

/** AI Review: ocena jako bohater ekranu, rekordy i konkretne cele na następny raz z „dlaczego”. */
export function ReviewView({ result, topInset, bottomInset, onDone }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: topInset + space.l, paddingBottom: bottomInset + space.l }]}>
      <Text style={styles.screenTitle}>Podsumowanie treningu</Text>
      <View style={styles.scoreRow} accessibilityLabel={`Ocena ${result.score} na 10`}>
        <Text style={styles.score}>{result.score}</Text>
        <Text style={styles.scoreOf}>/10</Text>
      </View>
      <Text style={styles.summary}>{result.review.summary}</Text>

      {result.records.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rekordy</Text>
          {result.records.map((r) => (
            <Text key={`${r.exerciseId}-${r.kind}`} style={styles.record}>
              {r.exerciseName}: {describeRecord(r)}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Następnym razem</Text>
        <Text style={styles.focus}>{result.review.nextFocus}</Text>
        {result.nextTargets.map((t) => {
          const isOpen = open === t.exerciseId;
          return (
            <Pressable
              key={t.exerciseId}
              onPress={() => setOpen(isOpen ? null : t.exerciseId)}
              style={styles.target}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
            >
              <View style={styles.targetTop}>
                <Text style={styles.targetName}>{t.exerciseName}</Text>
                <Text style={styles.targetValue}>{describeTarget(t)}</Text>
              </View>
              <Text style={isOpen ? styles.explanation : styles.why}>{isOpen ? t.explanation : 'Dlaczego?'}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.source}>
        {result.review.source === 'ai'
          ? 'Tekst napisała AI na podstawie wyliczeń silnika progresji.'
          : 'Podsumowanie z reguł silnika progresji.'}
      </Text>
      <PrimaryButton label="Gotowe" onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.l, gap: space.l },
  screenTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end' },
  score: { color: colors.text, fontFamily: fonts.display, fontSize: 112, fontWeight: '700', lineHeight: 112, fontVariant: ['tabular-nums'] },
  scoreOf: { color: colors.muted, fontFamily: fonts.display, fontSize: 40, fontWeight: '700', marginBottom: 14, marginLeft: 4 },
  summary: { color: colors.text, fontSize: 18, lineHeight: 26 },
  section: { gap: space.s },
  sectionTitle: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  record: { color: colors.progress, fontSize: 17, fontWeight: '600' },
  focus: { color: colors.text, fontSize: 17, lineHeight: 24 },
  target: { backgroundColor: colors.surface, borderRadius: radius.control, padding: space.m, gap: space.xs },
  targetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s },
  targetName: { color: colors.text, fontSize: 16, flex: 1 },
  targetValue: { color: colors.text, fontFamily: fonts.display, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  why: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  explanation: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  source: { color: colors.muted, fontSize: 13 },
});
