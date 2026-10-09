import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme/tokens';

interface Option<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

/** Duże kafle jednokrotnego wyboru (cel, doświadczenie, miejsce treningu). */
export function OptionList<T extends string | number>({ options, value, onChange }: { options: Option<T>[]; value: T | null | undefined; onChange: (v: T) => void }) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={({ pressed }: { pressed: boolean }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={o.label}
          >
            <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>{o.label}</Text>
              {o.description ? <Text style={styles.optionDescription}>{o.description}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Rząd krótkich wyborów (np. dni w tygodniu, długość sesji); multi = wiele naraz. */
export function ChipRow<T extends string | number>({ options, selected, onToggle, label }: { options: Option<T>[]; selected: readonly T[]; onToggle: (v: T) => void; label: string }) {
  return (
    <View style={styles.chips} accessibilityLabel={label}>
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onToggle(o.value)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}: ${o.label}`}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Text style={styles.boxMark}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: radius.control, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface },
  optionActive: { borderColor: colors.progress },
  pressed: { opacity: 0.7 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: colors.progress },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.progress },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: colors.text, fontSize: 17, fontWeight: '600' },
  optionDescription: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { minHeight: 44, minWidth: 52, paddingHorizontal: space.m, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  chipTextActive: { color: colors.bg },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  boxChecked: { backgroundColor: colors.progress, borderColor: colors.progress },
  boxMark: { color: colors.bg, fontWeight: '700' },
  checkLabel: { color: colors.text, fontSize: 15, lineHeight: 21, flex: 1 },
});
