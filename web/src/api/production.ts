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

function normalizeMode(value: unknown): ProductionProblemMode {
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
    problem_id: Number(row.problem_id),
    choice_id: Number(row.choice_id),
    usi: typeof row.usi === 'string' ? row.usi : '',
    label: typeof row.label === 'string' ? row.label : '',
    explanation: row.explanation == null ? null : String(row.explanation),
    line: normalizeTextArray(row.line),
    eval_cp: row.eval_cp == null ? null : Number(row.eval_cp),
    eval_percent: row.eval_percent == null ? null : Number(row.eval_percent),
  };
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

  const [nextMoveChoices, josekiChoices] = await Promise.all([
    listChoices(problemIds, 'next_move'),
    listChoices(problemIds, 'joseki'),
  ]);
  return [...nextMoveChoices, ...josekiChoices];
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

export async function deleteProductionProblemEverywhere(problemId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_next_move_problem_everywhere', {
    p_problem_id: problemId,
  });

  if (!error) return;

  const retry = await supabase.rpc('delete_next_move_problem_everywhere', {
    problem_id: problemId,
  });

  if (retry.error) throw retry.error;
}
