import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius, space } from '../theme/tokens';

export interface SetDraft {
  load: string;
  reps: string;
  rir: number | null;
  done: boolean;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

interface Props {
  index: number;
  draft: SetDraft;
  showLoad: boolean;
  unit: string;
  invalid: boolean;
  onChange: (next: SetDraft) => void;
  onToggleDone: () => void;
}

/** Jedna seria: ciężar, powtórzenia (lub sekundy), zapas RIR i zapis jednym tapnięciem. */
export function SetRow({ index, draft, showLoad, unit, invalid, onChange, onToggleDone }: Props) {
  const n = index + 1;
  return (
    <View style={[styles.row, draft.done && styles.rowDone, invalid && styles.rowInvalid]}>
      <View style={styles.top}>
        <Text style={styles.label}>Seria {n}</Text>
        {showLoad ? (
          <View style={styles.field}>
            <TextInput
              value={draft.load}
              onChangeText={(load: string) => onChange({ ...draft, load })}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.muted}
              selectTextOnFocus
              style={styles.input}
              accessibilityLabel={`Ciężar w kilogramach, seria ${n}`}
            />
            <Text style={styles.unit}>kg</Text>
          </View>
        ) : null}
        <View style={styles.field}>
          <TextInput
            value={draft.reps}
            onChangeText={(reps: string) => onChange({ ...draft, reps })}
            keyboardType="number-pad"
            selectTextOnFocus
            style={styles.input}
            accessibilityLabel={`${unit === 's' ? 'Sekundy' : 'Powtórzenia'}, seria ${n}`}
          />
          <Text style={styles.unit}>{unit}</Text>
        </View>
        <Pressable
          onPress={onToggleDone}
          hitSlop={6}
          style={[styles.check, draft.done && styles.checkDone]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.done }}
          accessibilityLabel={`Zapisz serię ${n}`}
        >
          <Text style={[styles.checkMark, draft.done && styles.checkMarkDone]}>✓</Text>
        </Pressable>
      </View>
      <View style={styles.rirRow}>
        <Text style={styles.rirLabel}>Zapas powt. (RIR)</Text>
        {RIR_OPTIONS.map((value) => {
          const active = draft.rir === value;
          return (
            <Pressable
              key={value}
              onPress={() => onChange({ ...draft, rir: active ? null : value })}
              hitSlop={2}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={value === 4 ? 'Zapas 4 lub więcej powtórzeń' : `Zapas ${value} powtórzeń`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{value === 4 ? '4+' : String(value)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, borderRadius: radius.control, padding: space.m, gap: space.m, borderWidth: 1, borderColor: colors.surface },
  rowDone: { borderColor: colors.progress },
  rowInvalid: { borderColor: colors.danger },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  label: { color: colors.muted, fontSize: 15, width: 64 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flex: 1, minWidth: 0 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.control,
    paddingHorizontal: space.s,
    textAlign: 'center',
  },
  unit: { color: colors.muted, fontSize: 14 },
  check: { width: 48, height: 48, borderRadius: radius.control, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: colors.progress, borderColor: colors.progress },
  checkMark: { color: colors.muted, fontSize: 22, fontWeight: '700' },
  checkMarkDone: { color: colors.bg },
  rirRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rirLabel: { color: colors.muted, fontSize: 13, flex: 1 },
  chip: { minWidth: 44, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipTextActive: { color: colors.bg },
});
