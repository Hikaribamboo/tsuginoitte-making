import type { ChoiceDraft } from '../types/problem';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';

export interface ProblemCreatorDraft {
  version: 1;
  favoriteId: number;
  rootSfen: string;
  prompt: string;
  tags: string[];
  displayNo: number | null;
  introMoves: string;
  problemRating: number;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  activeSlot: SlotKey | null;
  choices: Record<SlotKey, ChoiceDraft>;
  savedAt: string;
  /** Slot currently being edited (explanation input focused). null = no one editing. */
  editingSlot?: SlotKey | null;
  /** ISO timestamp of when editingSlot was set. */
  editingAt?: string | null;
}

export function isProblemCreatorDraft(value: unknown): value is ProblemCreatorDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ProblemCreatorDraft>;
  return draft.version === 1
    && typeof draft.favoriteId === 'number'
    && typeof draft.rootSfen === 'string'
    && typeof draft.prompt === 'string'
    && Array.isArray(draft.tags)
    && typeof draft.introMoves === 'string'
    && typeof draft.problemRating === 'number'
    && typeof draft.savedAt === 'string'
    && !!draft.choices;
}
