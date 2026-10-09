/** Stan demo w pamięci; jeśli przeglądarka pozwala, zachowany też w localStorage (przetrwa odświeżenie). */
const prefix = 'mp-power:demo:';

export function readState<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(prefix + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeState(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(prefix + key, JSON.stringify(value));
  } catch {
    // Brak dostępu do magazynu (np. tryb prywatny) — demo działa dalej w pamięci.
  }
}
