export function readStorageString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

export function writeStorageString(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

export function hasStorageValue(key: string): boolean {
  return readStorageString(key) !== null;
}

export function readStorageJson<T>(key: string, fallback: T): T {
  const raw = readStorageString(key);
  if (raw === null) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStorageJson(key: string, value: unknown): void {
  writeStorageString(key, JSON.stringify(value));
}
