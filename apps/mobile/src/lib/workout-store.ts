import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlayerPayload } from '@mp-power/core';
import type { SetDraft } from '../components/SetRow';

/** Trening w toku zapisany w telefonie: przetrwa zamknięcie aplikacji i brak zasięgu na siłowni. */
export interface SavedWorkout {
  version: 1;
  clientSessionId: string;
  payload: PlayerPayload;
  drafts: Record<string, SetDraft[]>;
  index: number;
  savedAt: string;
}

const key = (programDayId: string) => `mp-power:workout:${programDayId}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function loadWorkout(programDayId: string): Promise<SavedWorkout | null> {
  try {
    const raw = await AsyncStorage.getItem(key(programDayId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedWorkout;
    if (saved.version !== 1 || Date.now() - Date.parse(saved.savedAt) > MAX_AGE_MS) {
      await AsyncStorage.removeItem(key(programDayId));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export async function saveWorkout(programDayId: string, state: Omit<SavedWorkout, 'version' | 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(key(programDayId), JSON.stringify({ ...state, version: 1, savedAt: new Date().toISOString() }));
  } catch {
    // Brak miejsca w pamięci: trening działa dalej, tylko bez kopii w telefonie.
  }
}

export async function clearWorkout(programDayId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(programDayId));
  } catch {
    // Nic do zrobienia — wpis i tak wygaśnie po dobie.
  }
}
