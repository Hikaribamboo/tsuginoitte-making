import type { LearningMode, LearningProblemInput } from '../types/problem';
import { supabase } from './rpc';

export type SaveProblemInput = {
  prompt: string;
  root_sfen: string;
  correct_choice_id: number;
  intro_moves_usi: string[];
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  problem_rating: number;
  problem_rating_games: number;
  display_no: number | null;
  tags: string[] | null;
};

export type SaveChoiceInput = {
  choice_id: number;
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
};

export type SaveProblemResult = {
  problemId: number;
};

export type SaveLearningProblemInput = SaveProblemInput & {
  mode: LearningMode;
  status?: 'draft' | 'active';
};

// ---- Normalization helpers ----

export function normalizeProblemForSave(problem: any): any {
  // Normalize intro_moves_usi and tags from null/undefined to []
  const intro_moves_usi = problem.intro_moves_usi ?? [];
  const tags = problem.tags ?? [];

  // Normalize root_sfen: if it ends with " 0 ", change to " 1 "
  let root_sfen = problem.root_sfen;
  if (root_sfen && /\s0\s*$/.test(root_sfen)) {
    root_sfen = root_sfen.replace(/\s0\s*$/, ' 1');
  }

  // Validate correct_choice_id
  if (problem.correct_choice_id < 1 || problem.correct_choice_id > 3) {
    throw new Error(`correct_choice_id must be 1-3, got ${problem.correct_choice_id}`);
  }

  return {
    ...problem,
    intro_moves_usi,
    tags,
    root_sfen,
  };
}

export function normalizeChoicesForSave(choices: SaveChoiceInput[]): SaveChoiceInput[] {
  // Validate that we have exactly 3 choices with ids 1, 2, 3
  const choiceIds = new Set(choices.map(c => c.choice_id));
  if (choiceIds.size !== 3 || !choiceIds.has(1) || !choiceIds.has(2) || !choiceIds.has(3)) {
    throw new Error('choices must have exactly choice_id 1, 2, and 3');
  }

  const normalized = choices.map(choice => {
    // Normalize line from null/undefined to []
    const line = choice.line ?? [];

    // Trim label and remove extra spaces
    let label = (choice.label || '').trim();
    label = label.replace(/\s+/g, ' ');

    // Skip empty choices (both usi and label are empty)
    if (!choice.usi && !label) {
      throw new Error(`choice_id ${choice.choice_id}: usi and label cannot both be empty`);
    }

    return {
      ...choice,
      label,
      line,
    };
  });

  return normalized;
}

// ---- Display No allocation ----

export async function getNextDisplayNoByMode(mode: LearningMode): Promise<number> {
  if (mode === 'new_mode') {
    throw new Error('new_mode does not use production display_no allocation');
  }

  const { data, error } = await supabase
    .from('problems')
    .select('display_no')
    .eq('mode', mode)
    .not('display_no', 'is', null)
    .order('display_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const currentMax = data?.display_no == null ? 0 : Number(data.display_no);
  if (!Number.isFinite(currentMax) || currentMax < 0) {
    throw new Error(`invalid display_no found in problems: ${String(data?.display_no)}`);
  }

  return Math.floor(currentMax) + 1;
}

function isDisplayNoUniqueViolation(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const text = [
    err?.code,
    err?.message,
    err?.details,
    err?.hint,
  ].map((value) => String(value ?? '')).join(' ');

  return (
    text.includes('23505') ||
    text.includes('duplicate key') ||
    text.includes('unique constraint') ||
    text.includes('display_no')
  );
}

function createDisplayNoDuplicateError(displayNo: number | null, mode: LearningMode): Error {
  const label = mode === 'next_move' ? '次の一手' : '定跡';
  return new Error(
    displayNo == null
      ? `${label}のdisplay_noが重複しています。再度保存してください。`
      : `${label}のdisplay_no ${displayNo} は既に使われています。別の番号を指定してください。`,
  );
}

export async function getNextDisplayNo(): Promise<number> {
  return getNextDisplayNoByMode('next_move');
}

// ---- Save Learning Problem (mode-aware) ----

export async function saveLearningProblem(
  problem: SaveLearningProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  const mode = problem.mode;

  if (mode === 'joseki' && (problem.intro_moves_usi?.length ?? 0) === 0) {
    throw new Error('定跡モードでは intro_moves_usi を1手以上指定してください');
  }

  // Normalize before save
  const normalizedProblem = normalizeProblemForSave(problem);
  const normalizedChoices = normalizeChoicesForSave(choices);

  if (mode === 'next_move' || mode === 'joseki') {
    // Save directly to problems / problem_choices
    return saveProblemToProblemsTable(normalizedProblem, normalizedChoices);
  }

  throw new Error(`unknown mode: ${mode}`);
}

async function saveProblemToProblemsTable(
  problem: SaveLearningProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  // Save directly to problems / problem_choices
  const problemRating = problem.problem_rating ?? 1500;
  const problemRatingGames = problem.problem_rating_games ?? 0;
  const status = problem.status ?? 'active';
  const displayNoToUse = problem.display_no ?? await getNextDisplayNoByMode(problem.mode);

  const { data: problemData, error } = await supabase
    .from('problems')
    .insert({
      prompt: problem.prompt,
      root_sfen: problem.root_sfen,
      correct_choice_id: problem.correct_choice_id,
      intro_moves_usi: problem.intro_moves_usi,
      root_eval_cp: problem.root_eval_cp,
      root_eval_percent: problem.root_eval_percent,
      problem_rating: problemRating,
      problem_rating_games: problemRatingGames,
      display_no: displayNoToUse,
      tags: problem.tags,
      mode: problem.mode,
      status,
    })
    .select('id')
    .single();

  if (error) {
    if (isDisplayNoUniqueViolation(error)) {
      throw createDisplayNoDuplicateError(displayNoToUse, problem.mode);
    }
    throw error;
  }

  if (!problemData) {
    throw new Error('failed to insert problem');
  }

  const problemId = problemData.id as number;

  const choiceRows = choices.map((choice) => ({
    problem_id: problemId,
    choice_id: choice.choice_id,
    usi: choice.usi,
    label: choice.label,
    explanation: choice.explanation,
    line: choice.line,
    eval_cp: choice.eval_cp,
    eval_percent: choice.eval_percent,
  }));

  const { error: choicesError } = await supabase
    .from('problem_choices')
    .insert(choiceRows);

  if (choicesError) {
    throw choicesError;
  }

  return { problemId };
}

// ---- Save Problem (backward-compatible wrapper) ----

export async function saveProblem(
  problem: SaveProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  // Backward-compatible wrapper: treat as next_move
  return saveLearningProblem(
    {
      ...problem,
      mode: 'next_move',
    },
    choices,
  );
}

export async function saveMultipleProblems(
  problems: Array<{
    prompt: string;
    rootSfen: string;
    correctMove: string;
    correctMoveLabel: string;
    introMovesUsi: string[];
    problemRating: number;
    tags: string[] | null;
    incorrectMove1?: string;
    incorrectMove1Label?: string;
    incorrectMove2?: string;
    incorrectMove2Label?: string;
  }>,
): Promise<SaveProblemResult[]> {
  const results: SaveProblemResult[] = [];

  for (const problemData of problems) {
    const problem: SaveProblemInput = {
      prompt: problemData.prompt,
      root_sfen: problemData.rootSfen,
      correct_choice_id: 1,
      intro_moves_usi: problemData.introMovesUsi,
      root_eval_cp: null,
      root_eval_percent: null,
      problem_rating: problemData.problemRating,
      problem_rating_games: 0,
      // leave display_no null so saveProblem will allocate a safe value
      display_no: null,
      tags: problemData.tags,
    };

    const choices: SaveChoiceInput[] = [
      {
        choice_id: 1,
        usi: problemData.correctMove,
        label: problemData.correctMoveLabel,
        explanation: '',
        line: [],
        eval_cp: null,
        eval_percent: null,
      },
      {
        choice_id: 2,
        usi: problemData.incorrectMove1 ?? '',
        label: problemData.incorrectMove1Label ?? '',
        explanation: '',
        line: [],
        eval_cp: null,
        eval_percent: null,
      },
      {
        choice_id: 3,
        usi: problemData.incorrectMove2 ?? '',
        label: problemData.incorrectMove2Label ?? '',
        explanation: '',
        line: [],
        eval_cp: null,
        eval_percent: null,
      },
    ];

    const result = await saveProblem(problem, choices);
    results.push(result);
  }

  return results;
}
