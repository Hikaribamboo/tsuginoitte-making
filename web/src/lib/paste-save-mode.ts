export type PasteSaveMode = 'next_move' | 'joseki' | 'new_mode';
export type WorkspaceModeFilter = 'all' | PasteSaveMode;

const LAST_PASTE_SAVE_MODE_KEY = 'making:last-paste-save-mode';
const LAST_WORKSPACE_MODE_FILTER_KEY = 'making:last-workspace-mode-filter';
const PASTE_SAVE_MODES: ReadonlySet<PasteSaveMode> = new Set(['next_move', 'joseki', 'new_mode']);
const WORKSPACE_MODE_FILTERS: ReadonlySet<WorkspaceModeFilter> = new Set(['all', 'next_move', 'joseki', 'new_mode']);

export function getLastPasteSaveMode(): PasteSaveMode {
  if (typeof window === 'undefined') return 'next_move';

  const value = window.localStorage.getItem(LAST_PASTE_SAVE_MODE_KEY);
  return PASTE_SAVE_MODES.has(value as PasteSaveMode) ? (value as PasteSaveMode) : 'next_move';
}

export function saveLastPasteSaveMode(mode: PasteSaveMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_PASTE_SAVE_MODE_KEY, mode);
}

export function getLastWorkspaceModeFilter(): WorkspaceModeFilter {
  if (typeof window === 'undefined') return 'all';

  const value = window.localStorage.getItem(LAST_WORKSPACE_MODE_FILTER_KEY);
  return WORKSPACE_MODE_FILTERS.has(value as WorkspaceModeFilter) ? (value as WorkspaceModeFilter) : 'all';
}

export function saveLastWorkspaceModeFilter(filter: WorkspaceModeFilter): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_WORKSPACE_MODE_FILTER_KEY, filter);
}
