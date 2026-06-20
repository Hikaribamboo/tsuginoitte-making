import { supabase } from './rpc';
import { stopAnalysis } from './backend';
import { DEFAULT_PROMPT } from '../lib/constants';
import { INITIAL_SFEN } from '../lib/sfen';
import { finiteNumberOrNull, isRecord, normalizeStringArray } from '../lib/data-normalize';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';

type DraftMode = 'next_move' | 'joseki' | 'new_mode';

type DraftPayload = Record<string, unknown>;

interface DraftProblemRow {
  id: number;
  workspace_id?: string | null;
  mode: DraftMode;
  status: string;
  prompt: string;
  root_sfen: string;
  intro_moves_usi: string[];
  correct_choice_id: number;
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  problem_rating: number | null;
  problem_rating_games: number | null;
  manual_difficulty_tier?: number | null;
  display_no: number | null;
  tags: string[] | null;
  review_comment?: string | null;
  production_problem_id?: number | null;
  source_type: string | null;
  source_ref: string | null;
  source_payload: Record<string, unknown> | null;
  source_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface DraftChoiceRow {
  id?: number;
  draft_problem_id: number;
  choice_id: number;
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
  source_snapshot?: Record<string, unknown> | null;
}

export interface Workspace {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  draft: Record<string, unknown> | null;
}

export interface NewModeRootSfenDuplicate {
  id: string;
  displayNo: number | null;
  prompt: string;
  updatedAt: string;
}

function getSourcePayload(row: DraftProblemRow): Record<string, unknown> {
  return isRecord(row.source_payload) ? row.source_payload : {};
}

function getDraftPayload(row: DraftProblemRow): DraftPayload {
  const payload = getSourcePayload(row);
  return isRecord(payload.draft_payload) ? payload.draft_payload : {};
}

function isWorkspaceHidden(row: DraftProblemRow): boolean {
  return getSourcePayload(row).workspace_hidden === true;
}

function workspaceName(row: DraftProblemRow): string {
  const payload = getSourcePayload(row);
  const value = payload.workspace_name ?? payload.name ?? payload.title;
  return typeof value === 'string' && value.trim() ? value : `#${row.id} 下書き`;
}

function emptyChoice(slotLabel: SlotKey) {
  return {
    slotLabel,
    usi: '',
    label: '',
    explanation: '',
    line: [],
    eval_cp: null,
    eval_percent: null,
  };
}

function choiceToDraft(slotLabel: SlotKey, row: DraftChoiceRow | null | undefined) {
  if (!row) return emptyChoice(slotLabel);
  return {
    slotLabel,
    usi: row.usi ?? '',
    label: row.label ?? '',
    explanation: row.explanation ?? '',
    line: normalizeStringArray(row.line),
    eval_cp: row.eval_cp ?? null,
    eval_percent: row.eval_percent ?? null,
  };
}

function choicesToDraft(row: DraftProblemRow, choices: DraftChoiceRow[]) {
  const sorted = [...choices].sort((a, b) => a.choice_id - b.choice_id);
  const correct = sorted.find((choice) => choice.choice_id === row.correct_choice_id) ?? null;
  const incorrects = sorted.filter((choice) => choice.choice_id !== row.correct_choice_id);
  return {
    correct: choiceToDraft('correct', correct),
    incorrect1: choiceToDraft('incorrect1', incorrects[0]),
    incorrect2: choiceToDraft('incorrect2', incorrects[1]),
  };
}

function rowToWorkspace(row: DraftProblemRow, choices: DraftChoiceRow[] = []): Workspace {
  const payload = getSourcePayload(row);
  const draftPayload = getDraftPayload(row);
  const readingLineInputs = isRecord(draftPayload.readingLineInputs)
    ? draftPayload.readingLineInputs
    : { correct: '', incorrect1: '', incorrect2: '' };

  const draft: Record<string, unknown> = {
    ...draftPayload,
    kifText: typeof draftPayload.kifText === 'string' ? draftPayload.kifText : '',
    rootSfen: row.root_sfen,
    kifMoves: normalizeStringArray(draftPayload.kifMoves),
    introMoveUsi: typeof draftPayload.introMoveUsi === 'string'
      ? draftPayload.introMoveUsi
      : row.intro_moves_usi[row.intro_moves_usi.length - 1] ?? '',
    choices: choicesToDraft(row, choices),
    readingLineInputs,
    prompt: row.prompt || DEFAULT_PROMPT,
    tags: row.tags ?? [],
    mode: row.mode,
    displayNo: row.display_no,
    problemRating: row.problem_rating ?? 1500,
    rootEvalCp: row.root_eval_cp,
    rootEvalPercent: row.root_eval_percent,
    savedAt: typeof draftPayload.savedAt === 'string' ? draftPayload.savedAt : row.updated_at,
  };

  if (payload.imagePositionSource) {
    draft.imagePositionSource = payload.imagePositionSource;
  }
  if (payload.sourceBranch) {
    draft.sourceBranch = payload.sourceBranch;
  }
  if (payload.sourceEngineJob) {
    draft.sourceEngineJob = payload.sourceEngineJob;
  }

  return {
    id: String(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: workspaceName(row),
    draft,
  };
}

function parseDraftProblemId(id: string): number {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid draft_problem_id: ${id}`);
  }
  return parsed;
}

async function fetchChoicesByDraftProblemIds(ids: number[]): Promise<Map<number, DraftChoiceRow[]>> {
  const grouped = new Map<number, DraftChoiceRow[]>();
  if (ids.length === 0) return grouped;

  const { data, error } = await supabase
    .from('making_draft_choices')
    .select('id, draft_problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent, source_snapshot')
    .in('draft_problem_id', ids)
    .order('draft_problem_id', { ascending: true })
    .order('choice_id', { ascending: true });

  if (error) throw error;

  for (const row of (data ?? []) as DraftChoiceRow[]) {
    const current = grouped.get(row.draft_problem_id) ?? [];
    current.push(row);
    grouped.set(row.draft_problem_id, current);
  }
  return grouped;
}

function draftMode(draft: DraftPayload): DraftMode {
  if (draft.mode === 'new_mode') return 'new_mode';
  return draft.mode === 'joseki' ? 'joseki' : 'next_move';
}

function draftChoiceRows(draftProblemId: number, draft: DraftPayload): DraftChoiceRow[] {
  const rawChoices = isRecord(draft.choices) ? draft.choices : {};
  const slots: SlotKey[] = ['correct', 'incorrect1', 'incorrect2'];
  return slots.map((slot, index) => {
    const source = isRecord(rawChoices[slot]) ? rawChoices[slot] : {};
    return {
      draft_problem_id: draftProblemId,
      choice_id: index + 1,
      usi: typeof source.usi === 'string' ? source.usi : '',
      label: typeof source.label === 'string' ? source.label : '',
      explanation: typeof source.explanation === 'string' ? source.explanation : '',
      line: normalizeStringArray(source.line),
      eval_cp: finiteNumberOrNull(source.eval_cp),
      eval_percent: finiteNumberOrNull(source.eval_percent),
      source_snapshot: {
        slot,
        saved_from: 'workspace_compat_api',
      },
    };
  });
}

function sourceTypeForDraft(draft: DraftPayload, fallback: string | null | undefined): string {
  if (fallback && fallback !== 'manual') return fallback;
  if (isRecord(draft.imagePositionSource)) return 'image_position_creator';
  if (isRecord(draft.sourceEngineJob)) {
    const kind = draft.sourceEngineJob.kind;
    return kind === 'kifs' ? 'kif_problem_generation' : 'local_book';
  }
  if (typeof draft.kifText === 'string' && draft.kifText.trim()) return 'pasted_kifu';
  return 'manual';
}

function sourcePayloadForDraft(
  existing: Record<string, unknown>,
  name: string,
  draft: DraftPayload,
): Record<string, unknown> {
  const {
    choices: _choices,
    imagePositionSource,
    sourceBranch,
    sourceEngineJob,
    ...draftPayload
  } = draft;

  return {
    ...existing,
    workspace_name: name,
    draft_payload: draftPayload,
    ...(imagePositionSource !== undefined ? { imagePositionSource } : {}),
    ...(sourceBranch !== undefined ? { sourceBranch } : {}),
    ...(sourceEngineJob !== undefined ? { sourceEngineJob } : {}),
  };
}

function introMovesForDraft(draft: DraftPayload): string[] {
  if (isRecord(draft.sourceBranch)) {
    const sourceBranchMoves = normalizeStringArray(draft.sourceBranch.introMovesUsi);
    if (sourceBranchMoves.length > 0) return sourceBranchMoves;
  }
  const introMoveUsi = typeof draft.introMoveUsi === 'string' ? draft.introMoveUsi.trim() : '';
  if (introMoveUsi) return [introMoveUsi];
  return normalizeStringArray(draft.kifMoves);
}

/** List all authoring drafts ordered from oldest to newest. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('making_draft_problems')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as DraftProblemRow[];
  const visibleRows = rows.filter((row) => !isWorkspaceHidden(row));
  const choicesById = await fetchChoicesByDraftProblemIds(visibleRows.map((row) => row.id));
  return visibleRows.map((row) => rowToWorkspace(row, choicesById.get(row.id) ?? []));
}

/** Create a new authoring draft. */
export async function createWorkspace(name: string): Promise<Workspace> {
  const { data, error } = await supabase
    .from('making_draft_problems')
    .insert({
      workspace_id: null,
      mode: 'next_move',
      status: 'draft',
      prompt: '',
      root_sfen: INITIAL_SFEN,
      intro_moves_usi: [],
      correct_choice_id: 1,
      root_eval_cp: null,
      root_eval_percent: null,
      problem_rating: 1500,
      problem_rating_games: 0,
      manual_difficulty_tier: null,
      display_no: null,
      tags: [],
      review_comment: null,
      source_type: 'manual',
      source_ref: null,
      source_payload: {
        workspace_name: name,
        draft_payload: null,
      },
      source_snapshot: {
        created_from: 'workspace_compat_api',
      },
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToWorkspace(data as DraftProblemRow);
}

/** Update draft display name. */
export async function renameWorkspace(id: string, name: string): Promise<void> {
  const current = await getWorkspace(id);
  if (!current) return;
  const draftProblemId = parseDraftProblemId(id);
  const { data, error: fetchError } = await supabase
    .from('making_draft_problems')
    .select('source_payload')
    .eq('id', draftProblemId)
    .single();
  if (fetchError) throw fetchError;

  const sourcePayload = isRecord(data?.source_payload) ? data.source_payload : {};
  const { error } = await supabase
    .from('making_draft_problems')
    .update({
      source_payload: {
        ...sourcePayload,
        workspace_name: name,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftProblemId);
  if (error) throw error;
}

/** Hide a draft from the workspace list without deleting its DB row. */
export async function hideWorkspaceFromList(id: string): Promise<void> {
  const draftProblemId = parseDraftProblemId(id);
  const { data, error: fetchError } = await supabase
    .from('making_draft_problems')
    .select('source_payload')
    .eq('id', draftProblemId)
    .single();
  if (fetchError) throw fetchError;

  const sourcePayload = isRecord(data?.source_payload) ? data.source_payload : {};
  const { error } = await supabase
    .from('making_draft_problems')
    .update({
      source_payload: {
        ...sourcePayload,
        workspace_hidden: true,
        workspace_hidden_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftProblemId);
  if (error) throw error;
}

/** Save draft data to making_draft_problems / making_draft_choices. */
export async function saveWorkspaceDraft(
  id: string,
  draft: Record<string, unknown>,
): Promise<void> {
  const draftProblemId = parseDraftProblemId(id);
  const { data: current, error: fetchError } = await supabase
    .from('making_draft_problems')
    .select('*')
    .eq('id', draftProblemId)
    .single();
  if (fetchError) throw fetchError;

  const currentRow = current as DraftProblemRow;
  const existingPayload = getSourcePayload(currentRow);
  const name = workspaceName(currentRow);
  const mode = draftMode(draft);
  const rootSfen = typeof draft.rootSfen === 'string' && draft.rootSfen.trim()
    ? draft.rootSfen
    : INITIAL_SFEN;

  const { error: updateError } = await supabase
    .from('making_draft_problems')
    .update({
      mode,
      status: currentRow.status || 'draft',
      prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
      root_sfen: rootSfen,
      intro_moves_usi: introMovesForDraft(draft),
      correct_choice_id: 1,
      root_eval_cp: finiteNumberOrNull(draft.rootEvalCp),
      root_eval_percent: finiteNumberOrNull(draft.rootEvalPercent),
      problem_rating: finiteNumberOrNull(draft.problemRating) ?? 1500,
      problem_rating_games: currentRow.problem_rating_games ?? 0,
      display_no: finiteNumberOrNull(draft.displayNo),
      tags: normalizeStringArray(draft.tags),
      source_type: sourceTypeForDraft(draft, currentRow.source_type),
      source_payload: sourcePayloadForDraft(existingPayload, name, draft),
      source_snapshot: {
        saved_from: 'workspace_compat_api',
        saved_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftProblemId);
  if (updateError) throw updateError;

  const choiceRows = draftChoiceRows(draftProblemId, draft);
  const { error: choicesError } = await supabase
    .from('making_draft_choices')
    .upsert(choiceRows, { onConflict: 'draft_problem_id,choice_id' });
  if (choicesError) throw choicesError;
}

function textArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function findNewModeDraftByRootSfenAndIntro(
  rootSfen: string,
  introMovesUsi: string[],
  excludeId?: string | null,
): Promise<NewModeRootSfenDuplicate | null> {
  const normalizedRootSfen = rootSfen.trim();
  const normalizedIntroMovesUsi = introMovesUsi.map((move) => move.trim()).filter(Boolean);
  if (!normalizedRootSfen || normalizedIntroMovesUsi.length === 0) return null;

  const excludeDraftProblemId = excludeId ? parseDraftProblemId(excludeId) : null;
  let query = supabase
    .from('making_draft_problems')
    .select('id, display_no, prompt, intro_moves_usi, updated_at')
    .eq('mode', 'new_mode')
    .eq('root_sfen', normalizedRootSfen)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (excludeDraftProblemId !== null) {
    query = query.neq('id', excludeDraftProblemId);
  }

  const { data, error } = await query;
  if (error) throw error;
  const duplicate = ((data ?? []) as Array<{
    id: number;
    display_no: number | null;
    prompt: string | null;
    intro_moves_usi: string[] | null;
    updated_at: string | null;
  }>).find((row) => textArraysEqual(normalizeStringArray(row.intro_moves_usi), normalizedIntroMovesUsi));

  if (!duplicate) return null;

  return {
    id: String(duplicate.id),
    displayNo: duplicate.display_no == null ? null : Number(duplicate.display_no),
    prompt: duplicate.prompt ?? '',
    updatedAt: duplicate.updated_at ?? '',
  };
}

/** Get a single authoring draft by making_draft_problems.id. */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const draftProblemId = parseDraftProblemId(id);
  const { data, error } = await supabase
    .from('making_draft_problems')
    .select('*')
    .eq('id', draftProblemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const choicesById = await fetchChoicesByDraftProblemIds([draftProblemId]);
  return rowToWorkspace(data as DraftProblemRow, choicesById.get(draftProblemId) ?? []);
}

/** Delete an authoring draft. */
export async function deleteWorkspace(id: string): Promise<void> {
  try {
    await stopAnalysis();
  } catch {
    // Deleting a draft should not fail just because the engine server is unavailable.
  }

  const draftProblemId = parseDraftProblemId(id);
  const { error: choicesError } = await supabase
    .from('making_draft_choices')
    .delete()
    .eq('draft_problem_id', draftProblemId);
  if (choicesError) throw choicesError;

  const { error } = await supabase
    .from('making_draft_problems')
    .delete()
    .eq('id', draftProblemId);
  if (error) throw error;
}
