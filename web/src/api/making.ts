import { supabase } from './rpc';
import type {
  CreateMakingDraftProblemInput,
  MakingDraftChoice,
  MakingDraftProblem,
  MakingDraftProblemFilters,
  MakingMode,
  MakingSourceType,
  UpdateMakingDraftProblemInput,
  UpsertMakingDraftChoiceInput,
} from '../types/making';

const MAKING_MODES: ReadonlySet<MakingMode> = new Set(['next_move', 'joseki', 'new_mode']);
const MAKING_SOURCE_TYPES: ReadonlySet<MakingSourceType> = new Set([
  'manual',
  'pasted_kifu',
  'pasted_sfen',
  'image',
  'image_position_creator',
  'kif_problem_generation',
  'engine_generated_next_move',
  'db_kifu',
  'local_book',
  'legacy_workspace',
  'legacy_review_next_move',
  'imported_legacy_workspace',
  'production_edit',
]);
const MAKING_WORKSPACE_STATUSES = new Set(['draft', 'validating', 'needs_fix', 'ready', 'published', 'archived']);

function nowIso(): string {
  return new Date().toISOString();
}

function cleanUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, current]) => current !== undefined)) as Partial<T>;
}

function assertOneOf(value: string, allowed: ReadonlySet<string>, label: string): void {
  if (!allowed.has(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function assertPercent(value: number, label: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 100) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function normalizeTextArray(value: string[] | undefined, fallback: string[] = []): string[] {
  return (value ?? fallback).map((item) => String(item));
}

function normalizeDraftProblemInput(input: CreateMakingDraftProblemInput): CreateMakingDraftProblemInput {
  assertOneOf(input.mode, MAKING_MODES, 'mode');
  assertIntegerInRange(input.correct_choice_id, 1, 3, 'correct_choice_id');

  if (input.source_type !== undefined && input.source_type !== null) {
    assertOneOf(input.source_type, MAKING_SOURCE_TYPES, 'source_type');
  }
  if (input.status !== undefined) {
    assertOneOf(input.status, MAKING_WORKSPACE_STATUSES, 'draft status');
  }
  if (input.problem_rating_games !== undefined) {
    assertNonNegativeInteger(input.problem_rating_games, 'problem_rating_games');
  }
  if (input.problem_rating !== undefined && input.problem_rating !== null) {
    assertNonNegativeInteger(input.problem_rating, 'problem_rating');
  }
  if (input.manual_difficulty_tier !== undefined && input.manual_difficulty_tier !== null) {
    assertIntegerInRange(input.manual_difficulty_tier, 1, 5, 'manual_difficulty_tier');
  }
  if (input.root_eval_percent !== undefined && input.root_eval_percent !== null) {
    assertPercent(input.root_eval_percent, 'root_eval_percent');
  }

  return {
    ...input,
    workspace_id: input.workspace_id ?? null,
    status: input.status ?? 'draft',
    intro_moves_usi: normalizeTextArray(input.intro_moves_usi),
    root_eval_cp: input.root_eval_cp ?? null,
    root_eval_percent: input.root_eval_percent ?? null,
    problem_rating: input.problem_rating ?? null,
    problem_rating_games: input.problem_rating_games ?? 0,
    manual_difficulty_tier: input.manual_difficulty_tier ?? null,
    display_no: input.display_no ?? null,
    tags: normalizeTextArray(input.tags),
    review_comment: input.review_comment ?? null,
    source_type: input.source_type ?? null,
    source_ref: input.source_ref ?? null,
    source_payload: input.source_payload ?? {},
    source_snapshot: input.source_snapshot ?? {},
  };
}

function normalizeDraftProblemPatch(patch: UpdateMakingDraftProblemInput): UpdateMakingDraftProblemInput {
  if (patch.mode !== undefined) {
    assertOneOf(patch.mode, MAKING_MODES, 'mode');
  }
  if (patch.source_type !== undefined && patch.source_type !== null) {
    assertOneOf(patch.source_type, MAKING_SOURCE_TYPES, 'source_type');
  }
  if (patch.status !== undefined) {
    assertOneOf(patch.status, MAKING_WORKSPACE_STATUSES, 'draft status');
  }
  if (patch.correct_choice_id !== undefined) {
    assertIntegerInRange(patch.correct_choice_id, 1, 3, 'correct_choice_id');
  }
  if (patch.problem_rating_games !== undefined) {
    assertNonNegativeInteger(patch.problem_rating_games, 'problem_rating_games');
  }
  if (patch.problem_rating !== undefined && patch.problem_rating !== null) {
    assertNonNegativeInteger(patch.problem_rating, 'problem_rating');
  }
  if (patch.manual_difficulty_tier !== undefined && patch.manual_difficulty_tier !== null) {
    assertIntegerInRange(patch.manual_difficulty_tier, 1, 5, 'manual_difficulty_tier');
  }
  if (patch.root_eval_percent !== undefined && patch.root_eval_percent !== null) {
    assertPercent(patch.root_eval_percent, 'root_eval_percent');
  }

  return patch;
}

function normalizeDraftChoiceInput(choice: UpsertMakingDraftChoiceInput): UpsertMakingDraftChoiceInput {
  assertIntegerInRange(choice.choice_id, 1, 3, 'choice_id');
  if (!choice.usi || !choice.usi.trim()) {
    throw new Error('invalid usi');
  }
  if (!choice.label || !choice.label.trim()) {
    throw new Error('invalid label');
  }
  if (choice.eval_percent !== undefined && choice.eval_percent !== null) {
    assertPercent(choice.eval_percent, 'eval_percent');
  }

  return {
    ...choice,
    usi: choice.usi.trim(),
    label: choice.label.trim(),
    eval_cp: choice.eval_cp ?? null,
    eval_percent: choice.eval_percent ?? null,
    line: normalizeTextArray(choice.line),
    explanation: choice.explanation ?? '',
  };
}

function sortByChoiceId<T extends { choice_id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.choice_id - b.choice_id);
}

export async function listMakingDraftProblems(
  filters: MakingDraftProblemFilters = {},
): Promise<MakingDraftProblem[]> {
  let query = supabase
    .from('making_draft_problems')
    .select('*')
    .order('updated_at', { ascending: false });

  if (filters.mode) query = query.eq('mode', filters.mode);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.sourceType) query = query.eq('source_type', filters.sourceType);
  if (filters.limit !== undefined) {
    const offset = filters.offset ?? 0;
    query = query.range(offset, offset + filters.limit - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MakingDraftProblem[];
}

export async function getMakingDraftProblem(draftProblemId: number): Promise<MakingDraftProblem | null> {
  const { data, error } = await supabase
    .from('making_draft_problems')
    .select('*')
    .eq('id', draftProblemId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as MakingDraftProblem | null;
}

export async function createMakingDraftProblem(
  input: CreateMakingDraftProblemInput,
): Promise<MakingDraftProblem> {
  const normalized = normalizeDraftProblemInput(input);
  const { data, error } = await supabase
    .from('making_draft_problems')
    .insert({
      workspace_id: normalized.workspace_id,
      mode: normalized.mode,
      status: normalized.status,
      prompt: normalized.prompt,
      root_sfen: normalized.root_sfen,
      intro_moves_usi: normalized.intro_moves_usi,
      correct_choice_id: normalized.correct_choice_id,
      root_eval_cp: normalized.root_eval_cp,
      root_eval_percent: normalized.root_eval_percent,
      problem_rating: normalized.problem_rating,
      problem_rating_games: normalized.problem_rating_games,
      manual_difficulty_tier: normalized.manual_difficulty_tier,
      display_no: normalized.display_no,
      tags: normalized.tags,
      review_comment: normalized.review_comment,
      source_type: normalized.source_type,
      source_ref: normalized.source_ref,
      source_payload: normalized.source_payload,
      source_snapshot: normalized.source_snapshot,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateMakingDraftProblem(
  draftProblemId: number,
  patch: UpdateMakingDraftProblemInput,
): Promise<MakingDraftProblem> {
  const normalized = normalizeDraftProblemPatch(patch);
  const { data, error } = await supabase
    .from('making_draft_problems')
    .update(cleanUndefined({
      ...normalized,
      updated_at: nowIso(),
    }))
    .eq('id', draftProblemId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function listMakingDraftChoices(draftProblemId: number): Promise<MakingDraftChoice[]> {
  const { data, error } = await supabase
    .from('making_draft_choices')
    .select('*')
    .eq('draft_problem_id', draftProblemId)
    .order('choice_id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function upsertMakingDraftChoices(
  draftProblemId: number,
  choices: UpsertMakingDraftChoiceInput[],
): Promise<MakingDraftChoice[]> {
  if (choices.length !== 3) {
    throw new Error('making_draft_choices requires exactly 3 choices');
  }

  const normalizedChoices = sortByChoiceId(
    choices.map((choice) => normalizeDraftChoiceInput(choice)),
  );

  const choiceIdSet = new Set(normalizedChoices.map((choice) => choice.choice_id));
  if (choiceIdSet.size !== 3 || !choiceIdSet.has(1) || !choiceIdSet.has(2) || !choiceIdSet.has(3)) {
    throw new Error('making_draft_choices requires choice_id 1, 2, and 3');
  }

  const rows = normalizedChoices.map((choice) => ({
    draft_problem_id: draftProblemId,
    choice_id: choice.choice_id,
    usi: choice.usi,
    label: choice.label,
    eval_cp: choice.eval_cp,
    eval_percent: choice.eval_percent,
    line: choice.line,
    explanation: choice.explanation,
    updated_at: nowIso(),
  }));

  const { data, error } = await supabase
    .from('making_draft_choices')
    .upsert(rows, { onConflict: 'draft_problem_id,choice_id' })
    .select('*');

  if (error) throw error;
  return sortByChoiceId((data ?? []) as MakingDraftChoice[]);
}
