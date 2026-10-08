import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space } from '../theme/tokens';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  grow?: boolean;
}

/** Jedna główna akcja na ekran (pomarańcz); pozostałe są drugorzędne. */
export function PrimaryButton({ label, onPress, variant = 'primary', disabled = false, loading = false, grow = false }: Props) {
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }: { pressed: boolean }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
        inactive && styles.inactive,
        grow && styles.grow,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.label, primary ? styles.labelPrimary : styles.labelSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 52, borderRadius: radius.control, paddingHorizontal: space.m, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  primary: { backgroundColor: colors.accent },
  primaryPressed: { backgroundColor: colors.accentPressed },
  secondary: { borderWidth: 1, borderColor: colors.line },
  secondaryPressed: { backgroundColor: colors.surface },
  inactive: { opacity: 0.45 },
  label: { fontSize: 17, fontWeight: '700' },
  labelPrimary: { color: colors.onAccent },
  labelSecondary: { color: colors.text },
});
