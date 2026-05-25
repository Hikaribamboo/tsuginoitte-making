import { supabase } from './rpc';
import type {
  ProductionChoice,
  ProductionProblem,
  ProductionProblemDetail,
  ProductionProblemFilters,
  ProductionProblemMode,
  UpdateProductionProblemInput,
} from '../types/production';

function normalizeMode(value: unknown): ProductionProblemMode {
  return value === 'joseki' ? 'joseki' : 'next_move';
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeProblemRow(row: Record<string, unknown>): ProductionProblem {
  return {
    problemId: Number(row.id),
    mode: normalizeMode(row.mode),
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

function normalizeChoiceRow(row: Record<string, unknown>): ProductionChoice {
  return {
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
  const { data, error } = await supabase
    .from('problems')
    .select(
      'id, mode, display_no, status, prompt, root_sfen, root_eval_cp, root_eval_percent, problem_rating, problem_rating_games, tags, correct_choice_id, intro_moves_usi, created_at, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(filters.limit ?? 500);

  if (error) throw error;

  let items = (data ?? []).map((row) => normalizeProblemRow(row as Record<string, unknown>));

  if (filters.mode && filters.mode !== 'all') {
    items = items.filter((item) => item.mode === filters.mode);
  }

  if (filters.status && filters.status !== 'all') {
    items = items.filter((item) => (item.status ?? '') === filters.status);
  }

  if (filters.query?.trim()) {
    items = items.filter((item) => searchMatches(item, filters.query ?? ''));
  }

  return items;
}

export async function listProductionChoicesByProblemIds(problemIds: number[]): Promise<ProductionChoice[]> {
  if (problemIds.length === 0) return [];

  const { data, error } = await supabase
    .from('problem_choices')
    .select('problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent')
    .in('problem_id', problemIds)
    .order('problem_id', { ascending: true })
    .order('choice_id', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => normalizeChoiceRow(row as Record<string, unknown>));
}

export async function getProductionProblemById(problemId: number): Promise<ProductionProblemDetail> {
  const { data: problem, error: problemError } = await supabase
    .from('problems')
    .select(
      'id, mode, display_no, status, prompt, root_sfen, root_eval_cp, root_eval_percent, problem_rating, problem_rating_games, tags, correct_choice_id, intro_moves_usi, created_at, updated_at',
    )
    .eq('id', problemId)
    .single();

  if (problemError) throw problemError;

  const { data: choices, error: choiceError } = await supabase
    .from('problem_choices')
    .select('problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent')
    .eq('problem_id', problemId)
    .order('choice_id', { ascending: true });

  if (choiceError) throw choiceError;

  return {
    ...normalizeProblemRow(problem as Record<string, unknown>),
    choices: (choices ?? []).map((row) => normalizeChoiceRow(row as Record<string, unknown>)),
  };
}

export async function updateProductionProblemById(
  problemId: number,
  problem: UpdateProductionProblemInput,
  choices: ProductionChoice[],
): Promise<ProductionProblemDetail> {
  const { error: problemError } = await supabase
    .from('problems')
    .update({
      prompt: problem.prompt,
      root_sfen: problem.rootSfen,
      correct_choice_id: problem.correctChoiceId,
      intro_moves_usi: problem.introMovesUsi,
      root_eval_cp: problem.rootEvalCp,
      root_eval_percent: problem.rootEvalPercent,
      problem_rating: problem.problemRating,
      problem_rating_games: problem.problemRatingGames,
      tags: problem.tags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', problemId);

  if (problemError) throw problemError;

  if (choices.length > 0) {
    const payload = choices.map((choice) => ({
      problem_id: problemId,
      choice_id: choice.choice_id,
      usi: choice.usi,
      label: choice.label,
      explanation: choice.explanation ?? '',
      line: choice.line,
      eval_cp: choice.eval_cp,
      eval_percent: choice.eval_percent,
      updated_at: new Date().toISOString(),
    }));

    const { error: choiceError } = await supabase
      .from('problem_choices')
      .upsert(payload, { onConflict: 'problem_id,choice_id' });

    if (choiceError) throw choiceError;
  }

  return getProductionProblemById(problemId);
}
