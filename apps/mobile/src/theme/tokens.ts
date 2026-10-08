import { Platform } from 'react-native';

/** Granat jako tło, pomarańcz wyłącznie dla głównej akcji, teal wyłącznie dla postępu, czerwień dla błędów. */
export const colors = {
  bg: '#0E1B2E',
  surface: '#17283F',
  surfaceRaised: '#1F3350',
  line: '#2B4161',
  text: '#F5F7FA',
  muted: '#8C9AB0',
  accent: '#FF6A1F',
  accentPressed: '#E8590F',
  onAccent: '#0E1B2E',
  progress: '#2BB3A3',
  danger: '#E5484D',
} as const;

/**
 * Liczby i nagłówki: wąski krój. Docelowo Archivo ExtraCondensed (pliki w assets/fonts, ładowane przez expo-font);
 * do tego czasu systemowe kroje wąskie dostępne w Expo Go.
 */
export const fonts = {
  display: Platform.select({ ios: 'AvenirNextCondensed-Bold', android: 'sans-serif-condensed', default: undefined }),
} as const;

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;
export const radius = { control: 12, sheet: 20 } as const;
