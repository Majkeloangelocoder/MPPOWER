import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts, radius, space } from '../theme/tokens';

interface Props {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  integer?: boolean;
}

/** Pole liczby z jednostką i podpowiedzią (np. jak zmierzyć obwód). */
export function NumberField({ label, unit, value, onChange, hint, error, optional, integer }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.label}>
            {label}
            {optional ? <Text style={styles.optional}>  opcjonalnie</Text> : null}
          </Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        <View style={[styles.field, error ? styles.fieldError : null]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            keyboardType={integer ? 'number-pad' : 'decimal-pad'}
            placeholder="–"
            placeholderTextColor={colors.muted}
            selectTextOnFocus
            style={styles.input}
            accessibilityLabel={unit ? `${label} w ${unit === 'cm' ? 'centymetrach' : unit === 'kg' ? 'kilogramach' : unit}` : label}
          />
          <Text style={styles.unit}>{unit}</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.text, fontSize: 17, fontWeight: '600' },
  optional: { color: colors.muted, fontSize: 13, fontWeight: '400' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.surfaceRaised, borderRadius: radius.control, paddingHorizontal: space.s, borderWidth: 1, borderColor: colors.surfaceRaised },
  fieldError: { borderColor: colors.danger },
  input: { width: 72, minWidth: 0, minHeight: 48, color: colors.text, fontFamily: fonts.display, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  unit: { color: colors.muted, fontSize: 14, width: 22 },
  error: { color: colors.danger, fontSize: 13 },
});
