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
  const currentMax = data?.display_no ?? 0;
  return Math.max(currentMax + 1, 201);
}

/** Save a problem and its choices in a single transaction-like flow */
export async function saveProblem(
  problem: Omit<Problem, 'id' | 'created_at'>,
  choices: Omit<Choice, 'problem_id'>[],
): Promise<{ problemId: number; reviewProblemId: number }> {
  function isDisplayNoConflict(error: any): boolean {
    const text = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase();
    return (error?.code === '23505' || error?.status === 409) && text.includes('display_no');
  }

  const reviewProblemPayload = {
    prompt: problem.prompt,
    root_sfen: problem.root_sfen,
    correct_choice_id: problem.correct_choice_id,
    intro_moves_usi: problem.intro_moves_usi,
    source_run_id: problem.source_run_id,
    root_eval_cp: problem.root_eval_cp,
    root_eval_percent: problem.root_eval_percent,
  };

  const reviewChoiceRows = choices.map((c) => ({
    choice_id: c.choice_id,
    usi: c.usi,
    label: c.label,
    explanation: c.explanation,
    line: c.line,
    eval: c.eval_cp,
    eval_cp: c.eval_cp,
    eval_percent: c.eval_percent,
  }));

  async function insertProblemRow(
    problemTable: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const { data: problemData, error: problemError } = await supabase
      .from(problemTable)
      .insert(payload)
      .select('id')
      .single();

    if (problemError) {
      console.error('[saveProblem] Problem insert failed', {
        table: problemTable,
        code: problemError.code,
        message: problemError.message,
        details: problemError.details,
        hint: problemError.hint,
        status: (problemError as any).status,
        display_no: payload.display_no,
      });
      throw problemError;
    }

    return problemData.id;
  }

  async function insertProblemWithChoices(
    payload: Record<string, unknown>,
    choicePayloads: Record<string, unknown>[],
    problemTable: string,
    choiceTable: string,
  ): Promise<number> {
    const insertedProblemId = await insertProblemRow(problemTable, payload);

    const choiceRows = choicePayloads.map((c) => ({
      ...c,
      problem_id: insertedProblemId,
    }));

    const { error: choiceError } = await supabase.from(choiceTable).insert(choiceRows);
    if (choiceError) {
      console.error('[saveProblem] Choice insert failed', {
        table: choiceTable,
        code: choiceError.code,
        message: choiceError.message,
        details: choiceError.details,
        hint: choiceError.hint,
        status: (choiceError as any).status,
        problem_id: insertedProblemId,
      });
      throw choiceError;
    }

    return insertedProblemId;
  }

  async function saveToBothTables(payload: Omit<Problem, 'id' | 'created_at'>) {
    const normalChoiceRows = choices.map((c) => ({
      choice_id: c.choice_id,
      usi: c.usi,
      label: c.label,
      explanation: c.explanation,
      line: c.line,
      eval_cp: c.eval_cp,
      eval_percent: c.eval_percent,
    }));

    const problemId = await insertProblemWithChoices(
      payload as unknown as Record<string, unknown>,
      normalChoiceRows,
      'next_move_problems',
      'next_move_choices',
    );
    const reviewProblemId = await insertProblemWithChoices(
      reviewProblemPayload,
      reviewChoiceRows,
      'review_next_move_problems',
      'review_next_move_choices',
    );
    return { problemId, reviewProblemId };
  }

  let attempt = 0;
  let currentPayload = { ...problem };

  while (attempt < 5) {
    try {
      return await saveToBothTables(currentPayload);
    } catch (error: any) {
      const canRetry = isDisplayNoConflict(error) && currentPayload.display_no != null;
      if (!canRetry) {
        console.error('[saveProblem] Save failed (no retry)', {
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          status: error?.status,
          attempt,
        });
        throw error;
      }

      const refreshedDisplayNo = await getNextDisplayNo();
      currentPayload = { ...currentPayload, display_no: refreshedDisplayNo };
      attempt += 1;
      console.warn('[saveProblem] display_no conflict; retrying with refreshed number', {
        attempt,
        refreshed_display_no: refreshedDisplayNo,
      });
    }
  }

  throw new Error('Failed to save problem after display_no retry attempts');
}
