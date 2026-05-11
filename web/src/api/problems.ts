import { supabase } from '../lib/supabase';

export type SaveProblemInput = {
  prompt: string;
  root_sfen: string;
  correct_choice_id: number;
  intro_moves_usi: string[];
  source_run_id: string | number | null;
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

export async function getNextDisplayNo(): Promise<number> {
  const { data, error } = await supabase
    .from('next_move_problems')
    .select('display_no')
    .not('display_no', 'is', null)
    .order('display_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const currentMax = data?.display_no ?? 0;
  return Math.max(currentMax + 1, 9);
}

export async function saveProblem(
  problem: SaveProblemInput,
  choices: SaveChoiceInput[],
): Promise<SaveProblemResult> {
  const { data: problemData, error: problemError } = await supabase
    .from('next_move_problems')
    .insert({
      prompt: problem.prompt,
      root_sfen: problem.root_sfen,
      correct_choice_id: problem.correct_choice_id,
      intro_moves_usi: problem.intro_moves_usi,
      source_run_id: problem.source_run_id,
      root_eval_cp: problem.root_eval_cp,
      root_eval_percent: problem.root_eval_percent,
      problem_rating: problem.problem_rating,
      problem_rating_games: problem.problem_rating_games,
      display_no: problem.display_no,
      tags: problem.tags,
    })
    .select('id')
    .single();

  if (problemError) {
    throw problemError;
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
  let nextDisplayNo = await getNextDisplayNo();

  for (const problemData of problems) {
    const problem: SaveProblemInput = {
      prompt: problemData.prompt,
      root_sfen: problemData.rootSfen,
      correct_choice_id: 1,
      intro_moves_usi: problemData.introMovesUsi,
      source_run_id: null,
      root_eval_cp: null,
      root_eval_percent: null,
      problem_rating: problemData.problemRating,
      problem_rating_games: 0,
      display_no: nextDisplayNo,
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
    nextDisplayNo += 1;
  }

  return results;
}