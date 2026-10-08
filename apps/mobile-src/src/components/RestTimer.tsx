import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock } from '../lib/format';
import { colors, fonts, radius, space } from '../theme/tokens';

interface Props {
  endsAt: number;
  total: number;
  onDone: () => void;
  onSkip: () => void;
  onAdd: (seconds: number) => void;
}

/** Przerwa między seriami: odliczanie, +30 s, pominięcie; wibracja na koniec. */
export function RestTimer({ endsAt, total, onDone, onSkip, onAdd }: Props) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    }
  }, [left, onDone]);

  const progress = total > 0 ? Math.min(1, 1 - left / total) : 1;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite" accessibilityLabel={`Przerwa, zostało ${left} sekund`}>
      <View style={styles.top}>
        <Text style={styles.time}>{formatClock(left)}</Text>
        <Text style={styles.caption}>przerwy</Text>
        <Pressable onPress={() => onAdd(30)} style={styles.action} accessibilityRole="button" accessibilityLabel="Wydłuż przerwę o 30 sekund">
          <Text style={styles.actionText}>+30 s</Text>
        </Pressable>
        <Pressable onPress={onSkip} style={styles.action} accessibilityRole="button" accessibilityLabel="Pomiń przerwę">
          <Text style={styles.actionText}>Pomiń</Text>
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surfaceRaised, borderRadius: radius.control, padding: space.m, gap: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  time: { color: colors.text, fontFamily: fonts.display, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caption: { color: colors.muted, fontSize: 15, flex: 1 },
  action: { minHeight: 44, paddingHorizontal: space.m, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  actionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.progress },
});
