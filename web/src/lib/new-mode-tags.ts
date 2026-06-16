const KNOWN_TAGS_KEY = 'making:new-mode-tags';
const LAST_SELECTED_TAGS_KEY = 'making:new-mode-last-selected-tags';

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of tags) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
}

function readStoredTags(key: string): string[] {
  if (typeof window === 'undefined') return [];

  try {
    return normalizeTags(JSON.parse(window.localStorage.getItem(key) ?? '[]'));
  } catch {
    return [];
  }
}

function writeStoredTags(key: string, tags: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(normalizeTags(tags)));
}

export function getNewModeKnownTags(): string[] {
  return readStoredTags(KNOWN_TAGS_KEY);
}

export function rememberNewModeTags(tags: string[]): string[] {
  const merged = normalizeTags([...getNewModeKnownTags(), ...tags]);
  writeStoredTags(KNOWN_TAGS_KEY, merged);
  return merged;
}

export function getLastNewModeTags(): string[] {
  return readStoredTags(LAST_SELECTED_TAGS_KEY);
}

export function saveLastNewModeTags(tags: string[]): void {
  const normalized = normalizeTags(tags);
  rememberNewModeTags(normalized);
  writeStoredTags(LAST_SELECTED_TAGS_KEY, normalized);
}
