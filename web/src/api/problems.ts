import { supabase } from '../lib/supabase';
import type { Problem, Choice } from '../types/problem';

/** Get the next display_no (max + 1) */
export async function getNextDisplayNo(): Promise<number> {
  const { data, error } = await supabase
    .from('next_move_problems')
    .select('display_no')
    .order('display_no', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return (data?.display_no ?? 0) + 1;
}

/** Save a problem and its choices in a single transaction-like flow */
export async function saveProblem(
  problem: Omit<Problem, 'id' | 'created_at'>,
  choices: Omit<Choice, 'problem_id'>[],
): Promise<{ problemId: number; reviewProblemId: number }> {
  async function insertProblemWithChoices(
    problemTable: string,
    choiceTable: string,
  ): Promise<number> {
    const { data: problemData, error: problemError } = await supabase
      .from(problemTable)
      .insert(problem)
      .select('id')
      .single();
    if (problemError) throw problemError;

    const insertedProblemId = problemData.id;

    const choiceRows = choices.map((c) => ({
      ...c,
      problem_id: insertedProblemId,
    }));

    const { error: choiceError } = await supabase.from(choiceTable).insert(choiceRows);
    if (choiceError) throw choiceError;

    return insertedProblemId;
  }

  // Main tables
  const problemId = await insertProblemWithChoices('next_move_problems', 'next_move_choices');

  // Review tables (same payload)
  const reviewProblemId = await insertProblemWithChoices(
    'review_next_move_problems',
    'review_next_move_choices',
  );

  return { problemId, reviewProblemId };
}
