import { supabase } from './rpc';
import type {
  ProductionChoice,
  ProductionProblem,
  ProductionProblemDetail,
  ProductionProblemFilters,
  ProductionProblemMode,
  UpdateProductionProblemInput,
} from '../types/production';

const PROBLEM_SELECT =
  'id, display_no, prompt, root_sfen, root_eval_cp, root_eval_percent, problem_rating, problem_rating_games, tags, correct_choice_id, intro_moves_usi, created_at, updated_at';
const PROBLEM_SELECT_WITH_MODE_STATUS = `id, mode, status, display_no, prompt, root_sfen, root_eval_cp, root_eval_percent, problem_rating, problem_rating_games, tags, correct_choice_id, intro_moves_usi, created_at, updated_at`;
const CHOICE_SELECT = 'problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent';
const DRAFT_PROBLEM_SELECT = `id, mode, status, display_no, prompt, root_sfen, root_eval_cp, root_eval_percent, problem_rating, problem_rating_games, tags, correct_choice_id, intro_moves_usi, created_at, updated_at`;
const DRAFT_CHOICE_SELECT = 'draft_problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent';

function normalizeMode(value: unknown): ProductionProblemMode {
  if (value === 'new_mode') return 'new_mode';
  return value === 'joseki' ? 'joseki' : 'next_move';
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const text = String((error as { message?: unknown })?.message ?? '');
  return text.includes(`'${column}' column`) || text.includes(`column "${column}"`) || text.includes(column);
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeProblemRow(row: Record<string, unknown>, fallbackMode: ProductionProblemMode): ProductionProblem {
  return {
    problemId: Number(row.id),
    mode: row.mode == null ? fallbackMode : normalizeMode(row.mode),
    displayNo: row.display_no == null ? null : Number(row.display_no),
    status: row.status == null ? null : String(row.status),
    prompt: typeof row.prompt === 'string' ? row.prompt : '',
    rootSfen: typeof row.root_sfen === 'string' ? row.root_sfen : '',
    rootEvalCp: row.root_eval_cp == null ? null : Number(row.root_eval_cp),
    rootEvalPercent: row.root_eval_percent == null ? null : Number(row.root_eval_percent),
    problemRating: row.problem_rating == null ? null : Number(row.problem_rating),
    problemRatingGames: row.problem_rating_games == null ? null : Number(row.problem_rating_games),
    tags: normalizeTextArray(row.tags),
    correctChoiceId: row.correct_choice_id == null ? 0 : Number(row.correct_choice_id),
    introMovesUsi: normalizeTextArray(row.intro_moves_usi),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

function normalizeChoiceRow(row: Record<string, unknown>, mode: ProductionProblemMode): ProductionChoice {
  return {
    mode,
    problem_id: Number(row.problem_id ?? row.draft_problem_id),
    choice_id: Number(row.choice_id),
    usi: typeof row.usi === 'string' ? row.usi : '',
    label: typeof row.label === 'string' ? row.label : '',
    explanation: row.explanation == null ? null : String(row.explanation),
    line: normalizeTextArray(row.line),
    eval_cp: row.eval_cp == null ? null : Number(row.eval_cp),
    eval_percent: row.eval_percent == null ? null : Number(row.eval_percent),
  };
}

async function listNewModeDraftProblems(limit: number): Promise<ProductionProblem[]> {
  const { data, error } = await supabase
    .from('making_draft_problems')
    .select(DRAFT_PROBLEM_SELECT)
    .eq('mode', 'new_mode')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => normalizeProblemRow(row as Record<string, unknown>, 'new_mode'));
}

async function listNextMoveProblems(limit: number): Promise<ProductionProblem[]> {
  const query = supabase
    .from('next_move_problems')
    .select(PROBLEM_SELECT_WITH_MODE_STATUS)
    .order('updated_at', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (!error) {
    return (data ?? []).map((row) => normalizeProblemRow(row as Record<string, unknown>, 'next_move'));
  }

  if (!isMissingColumnError(error, 'mode') && !isMissingColumnError(error, 'status')) {
    throw error;
  }

  const retry = await supabase
    .from('next_move_problems')
    .select(PROBLEM_SELECT)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (retry.error) throw retry.error;
  return (retry.data ?? []).map((row) => normalizeProblemRow(row as Record<string, unknown>, 'next_move'));
}

async function listJosekiProblems(limit: number): Promise<ProductionProblem[]> {
  const { data, error } = await supabase
    .from('problems')
    .select(PROBLEM_SELECT_WITH_MODE_STATUS)
    .eq('mode', 'joseki')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => normalizeProblemRow(row as Record<string, unknown>, 'joseki'));
}

async function getProblemRow(
  problemId: number,
  mode: ProductionProblemMode,
): Promise<ProductionProblem> {
  if (mode === 'new_mode') {
    const { data, error } = await supabase
      .from('making_draft_problems')
      .select(DRAFT_PROBLEM_SELECT)
      .eq('id', problemId)
      .eq('mode', 'new_mode')
      .single();

    if (error) throw error;
    return normalizeProblemRow(data as Record<string, unknown>, 'new_mode');
  }

  const table = mode === 'next_move' ? 'next_move_problems' : 'problems';
  const select = mode === 'next_move' ? PROBLEM_SELECT_WITH_MODE_STATUS : PROBLEM_SELECT_WITH_MODE_STATUS;
  const query = supabase.from(table).select(select).eq('id', problemId);
  const problemQuery = mode === 'joseki' ? query.eq('mode', 'joseki') : query;
  const { data, error } = await problemQuery.single();

  if (!error) {
    return normalizeProblemRow(data as Record<string, unknown>, mode);
  }

  if (mode !== 'next_move' || (!isMissingColumnError(error, 'mode') && !isMissingColumnError(error, 'status'))) {
    throw error;
  }

  const retry = await supabase
    .from('next_move_problems')
    .select(PROBLEM_SELECT)
    .eq('id', problemId)
    .single();

  if (retry.error) throw retry.error;
  return normalizeProblemRow(retry.data as Record<string, unknown>, 'next_move');
}

async function listChoices(problemIds: number[], mode: ProductionProblemMode): Promise<ProductionChoice[]> {
  if (problemIds.length === 0) return [];

  if (mode === 'new_mode') {
    const { data, error } = await supabase
      .from('making_draft_choices')
      .select(DRAFT_CHOICE_SELECT)
      .in('draft_problem_id', problemIds)
      .order('draft_problem_id', { ascending: true })
      .order('choice_id', { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) => normalizeChoiceRow(row as Record<string, unknown>, 'new_mode'));
  }

  const table = mode === 'next_move' ? 'next_move_choices' : 'problem_choices';
  const { data, error } = await supabase
    .from(table)
    .select(CHOICE_SELECT)
    .in('problem_id', problemIds)
    .order('problem_id', { ascending: true })
    .order('choice_id', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => normalizeChoiceRow(row as Record<string, unknown>, mode));
}

async function upsertChoices(
  problemId: number,
  mode: ProductionProblemMode,
  choices: ProductionChoice[],
): Promise<void> {
  if (choices.length === 0) return;

  if (mode === 'new_mode') {
    const rows = choices.map((choice) => ({
      draft_problem_id: problemId,
      choice_id: choice.choice_id,
      usi: choice.usi,
      label: choice.label,
      explanation: choice.explanation ?? '',
      line: choice.line,
      eval_cp: choice.eval_cp,
      eval_percent: choice.eval_percent,
      source_snapshot: {
        saved_from: 'new_mode_review',
        saved_at: new Date().toISOString(),
      },
    }));

    const { error } = await supabase
      .from('making_draft_choices')
      .upsert(rows, { onConflict: 'draft_problem_id,choice_id' });
    if (error) throw error;
    return;
  }

  const table = mode === 'next_move' ? 'next_move_choices' : 'problem_choices';
  const updatedAt = new Date().toISOString();
  const rows = choices.map((choice) => ({
    problem_id: problemId,
    choice_id: choice.choice_id,
    usi: choice.usi,
    label: choice.label,
    explanation: choice.explanation ?? '',
    line: choice.line,
    eval_cp: choice.eval_cp,
    eval_percent: choice.eval_percent,
  }));

  const updateRows = async (includeUpdatedAt: boolean) => {
    for (const row of rows) {
      const { problem_id: _problemId, choice_id: choiceId, ...choiceFields } = row;
      const updatePayload = includeUpdatedAt
        ? { ...choiceFields, updated_at: updatedAt }
        : choiceFields;
      const { data, error } = await supabase
        .from(table)
        .update(updatePayload)
        .eq('problem_id', problemId)
        .eq('choice_id', choiceId)
        .select('choice_id')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const { error: upsertError } = await supabase
          .from(table)
          .upsert(
            includeUpdatedAt
              ? { ...row, updated_at: updatedAt }
              : row,
            { onConflict: 'problem_id,choice_id' },
          );

        if (upsertError) throw upsertError;
      }
    }
  };

  try {
    await updateRows(true);
  } catch (error) {
    if (!isMissingColumnError(error, 'updated_at')) throw error;
    await updateRows(false);
  }
}

function searchMatches(problem: ProductionProblem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const tokens = normalized
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return true;

  const haystack = [
    problem.prompt,
    problem.tags.join(' '),
    problem.displayNo == null ? '' : String(problem.displayNo),
  ]
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

export async function listProductionProblems(
  filters: ProductionProblemFilters = {},
): Promise<ProductionProblem[]> {
  const limit = filters.limit ?? 500;
  let items: ProductionProblem[];

  if (filters.mode === 'next_move') {
    items = await listNextMoveProblems(limit);
  } else if (filters.mode === 'joseki') {
    items = await listJosekiProblems(limit);
  } else if (filters.mode === 'new_mode') {
    items = await listNewModeDraftProblems(limit);
  } else {
    const [nextMoveItems, josekiItems] = await Promise.all([
      listNextMoveProblems(limit),
      listJosekiProblems(limit),
    ]);
    items = [...nextMoveItems, ...josekiItems]
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .slice(0, limit);
  }

  if (filters.status && filters.status !== 'all') {
    items = items.filter((item) => (item.status ?? '') === filters.status);
  }

  if (filters.query?.trim()) {
    items = items.filter((item) => searchMatches(item, filters.query ?? ''));
  }

  return items;
}

export async function listProductionChoicesByProblemIds(
  problemIds: number[],
  mode: ProductionProblemMode | 'all' = 'all',
): Promise<ProductionChoice[]> {
  if (problemIds.length === 0) return [];

  if (mode === 'next_move') return listChoices(problemIds, 'next_move');
  if (mode === 'joseki') return listChoices(problemIds, 'joseki');
  if (mode === 'new_mode') return listChoices(problemIds, 'new_mode');

  const [nextMoveChoices, josekiChoices] = await Promise.all([
    listChoices(problemIds, 'next_move'),
    listChoices(problemIds, 'joseki'),
  ]);
  return [...nextMoveChoices, ...josekiChoices];
}

export interface DailyProblemCreationCount {
  date: string;
  nextMoveCount: number;
  josekiCount: number;
  newModeCount: number;
}

type CreatedAtRow = {
  id: number;
  created_at: string;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function countRowsByLocalDate(rows: CreatedAtRow[], counts: Map<string, number>): void {
  for (const row of rows) {
    const key = localDateKey(new Date(row.created_at));
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

export async function listDailyProblemCreationCounts(days = 20): Promise<DailyProblemCreationCount[]> {
  const normalizedDays = Math.max(1, Math.floor(days));
  const today = startOfLocalDay(new Date());
  const start = addLocalDays(today, -(normalizedDays - 1));

  const keys = Array.from({ length: normalizedDays }, (_, index) => localDateKey(addLocalDays(start, index)));
  const nextMoveCounts = new Map(keys.map((key) => [key, 0]));
  const josekiCounts = new Map(keys.map((key) => [key, 0]));
  const newModeCounts = new Map(keys.map((key) => [key, 0]));

  const [nextMoveResult, josekiResult, newModeResult] = await Promise.all([
    supabase
      .from('next_move_problems')
      .select('id, created_at')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .range(0, 9999),
    supabase
      .from('problems')
      .select('id, created_at')
      .eq('mode', 'joseki')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .range(0, 9999),
    supabase
      .from('making_draft_problems')
      .select('id, created_at')
      .eq('mode', 'new_mode')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .range(0, 9999),
  ]);

  if (nextMoveResult.error) throw nextMoveResult.error;
  if (josekiResult.error) throw josekiResult.error;
  if (newModeResult.error) throw newModeResult.error;

  countRowsByLocalDate((nextMoveResult.data ?? []) as CreatedAtRow[], nextMoveCounts);
  countRowsByLocalDate((josekiResult.data ?? []) as CreatedAtRow[], josekiCounts);
  countRowsByLocalDate((newModeResult.data ?? []) as CreatedAtRow[], newModeCounts);

  return keys
    .map((date) => ({
      date,
      nextMoveCount: nextMoveCounts.get(date) ?? 0,
      josekiCount: josekiCounts.get(date) ?? 0,
      newModeCount: newModeCounts.get(date) ?? 0,
    }))
    .reverse();
}

export async function getProductionProblemById(
  problemId: number,
  mode: ProductionProblemMode,
): Promise<ProductionProblemDetail> {
  const problem = await getProblemRow(problemId, mode);
  const choices = await listChoices([problemId], mode);

  return {
    ...problem,
    choices,
  };
}

export async function updateProductionProblemById(
  problemId: number,
  mode: ProductionProblemMode,
  problem: UpdateProductionProblemInput,
  choices: ProductionChoice[],
): Promise<ProductionProblemDetail> {
  if (mode === 'new_mode') {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('making_draft_problems')
      .update({
        prompt: problem.prompt,
        root_sfen: problem.rootSfen,
        correct_choice_id: problem.correctChoiceId,
        intro_moves_usi: problem.introMovesUsi,
        root_eval_cp: problem.rootEvalCp,
        root_eval_percent: problem.rootEvalPercent,
        problem_rating: problem.problemRating,
        problem_rating_games: problem.problemRatingGames ?? 0,
        tags: problem.tags,
        mode: 'new_mode',
        status: 'draft',
        source_snapshot: {
          saved_from: 'new_mode_review',
          saved_at: updatedAt,
        },
        updated_at: updatedAt,
      })
      .eq('id', problemId)
      .eq('mode', 'new_mode');

    if (error) throw error;
    await upsertChoices(problemId, mode, choices);
    return getProductionProblemById(problemId, mode);
  }

  const table = mode === 'next_move' ? 'next_move_problems' : 'problems';
  const updatedAt = new Date().toISOString();
  const basePayload = {
    prompt: problem.prompt,
    root_sfen: problem.rootSfen,
    correct_choice_id: problem.correctChoiceId,
    intro_moves_usi: problem.introMovesUsi,
    root_eval_cp: problem.rootEvalCp,
    root_eval_percent: problem.rootEvalPercent,
    problem_rating: problem.problemRating,
    problem_rating_games: problem.problemRatingGames,
    tags: problem.tags,
  };

  const updateProblem = async (includeUpdatedAt: boolean) => {
    const payload = includeUpdatedAt ? { ...basePayload, updated_at: updatedAt } : basePayload;
    const query = supabase.from(table).update(payload).eq('id', problemId);
    const problemQuery = mode === 'joseki' ? query.eq('mode', 'joseki') : query;
    return problemQuery.select('id').maybeSingle();
  };

  let problemResult = await updateProblem(true);
  if (problemResult.error) {
    if (!isMissingColumnError(problemResult.error, 'updated_at')) throw problemResult.error;
    problemResult = await updateProblem(false);
  }

  if (problemResult.error) throw problemResult.error;

  if (!problemResult.data) {
    const upsertPayload = mode === 'joseki'
      ? { id: problemId, mode: 'joseki', ...basePayload, updated_at: updatedAt }
      : { id: problemId, ...basePayload, updated_at: updatedAt };

    const { error: upsertError } = await supabase
      .from(table)
      .upsert(upsertPayload, { onConflict: 'id' });

    if (upsertError) throw upsertError;
  }

  await upsertChoices(problemId, mode, choices);

  return getProductionProblemById(problemId, mode);
}

export async function deleteProductionProblemEverywhere(
  problemId: number,
  mode: ProductionProblemMode = 'next_move',
): Promise<void> {
  if (mode === 'new_mode') {
    const { error: choicesError } = await supabase
      .from('making_draft_choices')
      .delete()
      .eq('draft_problem_id', problemId);
    if (choicesError) throw choicesError;

    const { error } = await supabase
      .from('making_draft_problems')
      .delete()
      .eq('id', problemId)
      .eq('mode', 'new_mode');
    if (error) throw error;
    return;
  }

  if (mode === 'joseki') {
    const { error: choicesError } = await supabase
      .from('problem_choices')
      .delete()
      .eq('problem_id', problemId);
    if (choicesError) throw choicesError;

    const { error } = await supabase
      .from('problems')
      .delete()
      .eq('id', problemId)
      .eq('mode', 'joseki');
    if (error) throw error;
    return;
  }

  const { error } = await supabase.rpc('delete_next_move_problem_everywhere', {
    p_problem_id: problemId,
  });

  if (!error) return;

  const retry = await supabase.rpc('delete_next_move_problem_everywhere', {
    problem_id: problemId,
  });

  if (retry.error) throw retry.error;
}
