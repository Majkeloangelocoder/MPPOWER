import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { supabase } from '../src/lib/supabase';
import { colors, fonts, radius, space } from '../src/theme/tokens';

const CONSENT_VERSION = '2026-10';

function authMessage(err: unknown): string {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (message.includes('invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.';
  if (message.includes('already registered')) return 'Konto z tym adresem już istnieje — zaloguj się.';
  if (message.includes('email not confirmed')) return 'Potwierdź adres e-mail linkiem z wiadomości, a potem się zaloguj.';
  if (message.includes('network') || message.includes('fetch')) return 'Brak połączenia z serwerem. Sprawdź internet.';
  return 'Nie udało się zalogować. Sprawdź dane i spróbuj ponownie.';
}

function Checkbox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Text style={styles.boxMark}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signUp = mode === 'signUp';

  const submit = async () => {
    setMessage(null);
    if (!email.includes('@') || password.length < 8) {
      setMessage('Podaj adres e-mail i hasło (co najmniej 8 znaków).');
      return;
    }
    if (signUp && (!adult || !terms)) {
      setMessage('Aby założyć konto, potwierdź pełnoletność oraz akceptację regulaminu i polityki prywatności.');
      return;
    }
    setBusy(true);
    try {
      if (!signUp) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace('/');
        return;
      }
      // Zgody trafiają do bazy razem z kontem (funkcja handle_new_user) — także przy potwierdzaniu e-maila.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { consents: { version: CONSENT_VERSION, terms: true, privacy: true }, adult_confirmed: true } },
      });
      if (error) throw error;
      if (data.session) {
        router.replace('/onboarding');
      } else {
        setMessage('Wysłaliśmy link potwierdzający na Twój e-mail. Po potwierdzeniu zaloguj się.');
        setMode('signIn');
      }
    } catch (err) {
      setMessage(authMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl * 2, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>MP POWER</Text>
        <Text style={styles.title}>{signUp ? 'Załóż konto' : 'Zaloguj się'}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-mail"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={styles.input}
          accessibilityLabel="Adres e-mail"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Hasło"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoComplete={signUp ? 'new-password' : 'current-password'}
          style={styles.input}
          accessibilityLabel="Hasło"
        />
        {signUp ? (
          <View style={styles.checks}>
            <Checkbox checked={adult} onToggle={() => setAdult((v: boolean) => !v)} label="Mam ukończone 18 lat." />
            <Checkbox checked={terms} onToggle={() => setTerms((v: boolean) => !v)} label="Akceptuję regulamin i politykę prywatności MP POWER." />
          </View>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <PrimaryButton label={signUp ? 'Załóż konto' : 'Zaloguj się'} onPress={() => void submit()} loading={busy} />
        <Pressable onPress={() => { setMode(signUp ? 'signIn' : 'signUp'); setMessage(null); }} style={styles.switch} accessibilityRole="button">
          <Text style={styles.switchText}>{signUp ? 'Masz już konto? Zaloguj się' : 'Nie masz konta? Załóż je'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.l, gap: space.m },
  brand: { color: colors.accent, fontFamily: fonts.display, fontSize: 22, fontWeight: '700', letterSpacing: 1 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 44, fontWeight: '700', marginBottom: space.s },
  input: { minHeight: 52, backgroundColor: colors.surface, borderRadius: radius.control, paddingHorizontal: space.m, color: colors.text, fontSize: 17 },
  checks: { gap: space.s },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  boxChecked: { backgroundColor: colors.progress, borderColor: colors.progress },
  boxMark: { color: colors.bg, fontWeight: '700' },
  checkLabel: { color: colors.text, fontSize: 15, flex: 1 },
  message: { color: colors.text, backgroundColor: colors.surfaceRaised, padding: space.m, borderRadius: radius.control, fontSize: 15, lineHeight: 21 },
  switch: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  switchText: { color: colors.muted, fontSize: 15 },
});
