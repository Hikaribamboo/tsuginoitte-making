import type { LearningMode, LearningProblemInput } from '../types/problem';
import { supabase } from './rpc';

const DISPLAY_NO_MIN = 49;

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
  let table: string;
  let filterMode: LearningMode | null = null;

  if (mode === 'next_move') {
    table = 'next_move_problems';
  } else {
    table = 'problems';
    filterMode = 'joseki';
  }

  let query = supabase
    .from(table)
    .select('display_no')
    .not('display_no', 'is', null);

  if (filterMode) {
    query = query.eq('mode', filterMode);
  }

  const { data, error } = await query.order('display_no', { ascending: true });

  if (error) {
    throw error;
  }

  // Collect all used display_no values
  const usedNumbers = new Set<number>();
  if (Array.isArray(data)) {
    for (const row of data) {
      if (typeof row.display_no === 'number') {
        usedNumbers.add(row.display_no);
      }
    }
  }

  // Find the first unused number starting from DISPLAY_NO_MIN
  for (let candidate = DISPLAY_NO_MIN; candidate <= DISPLAY_NO_MIN + 10000; candidate++) {
    if (!usedNumbers.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('failed to find available display_no');
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

  // Normalize before save
  const normalizedProblem = normalizeProblemForSave(problem);
  const normalizedChoices = normalizeChoicesForSave(choices);

  if (mode === 'next_move') {
    // Save to next_move_problems / next_move_choices
    return saveProblemToNextMoveTable(normalizedProblem, normalizedChoices);
  } else if (mode === 'joseki') {
    // Save directly to problems / problem_choices
    return saveProblemToProblemsTable(normalizedProblem, normalizedChoices);
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}

async function saveProblemToNextMoveTable(
  problem: SaveLearningProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  // Existing retry logic for next_move
  const MAX_RETRIES = 5;
  let lastError: any = null;
  let problemData: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const displayNoToUse = problem.display_no ?? await getNextDisplayNo();
    const { data, error } = await supabase
      .from('next_move_problems')
      .insert({
        prompt: problem.prompt,
        root_sfen: problem.root_sfen,
        correct_choice_id: problem.correct_choice_id,
        intro_moves_usi: problem.intro_moves_usi,
        root_eval_cp: problem.root_eval_cp,
        root_eval_percent: problem.root_eval_percent,
        problem_rating: problem.problem_rating,
        problem_rating_games: problem.problem_rating_games,
        display_no: displayNoToUse,
        tags: problem.tags,
      })
      .select('id')
      .single();

    if (!error) {
      problemData = data;
      break;
    }

    lastError = error;

    // If duplicate display_no, retry with a fresh next value
    const msg = String(error?.message || (error as any)?.details || '');
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      problem.display_no = null;
      continue;
    }

    throw error;
  }

  if (!problemData) {
    throw lastError || new Error('failed to insert problem');
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
    .from('next_move_choices')
    .insert(choiceRows);

  if (choicesError) {
    throw choicesError;
  }

  return { problemId };
}

async function saveProblemToProblemsTable(
  problem: SaveLearningProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  // Save directly to problems / problem_choices (joseki mode)
  const MAX_RETRIES = 5;
  let lastError: any = null;
  let problemData: any = null;

  const problemRating = problem.problem_rating ?? 1500;
  const problemRatingGames = problem.problem_rating_games ?? 0;
  const status =
    'active'

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const displayNoToUse = problem.display_no ?? await getNextDisplayNoByMode('joseki');
    const { data, error } = await supabase
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
        mode: 'joseki',
        status,
      })
      .select('id')
      .single();

    if (!error) {
      problemData = data;
      break;
    }

    lastError = error;

    const msg = String(error?.message || (error as any)?.details || '');
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      problem.display_no = null;
      continue;
    }

    throw error;
  }

  if (!problemData) {
    throw lastError || new Error('failed to insert problem');
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