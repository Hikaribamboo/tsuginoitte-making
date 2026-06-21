import type { ChoiceEvalFeature, ChoiceQuality, DraftProblem, DraftProblemChoice } from './types.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function classifyQuality(gapFromBest: number | null): ChoiceQuality {
  if (gapFromBest === null) return 'unknown';
  if (gapFromBest === 0) return 'best';
  if (gapFromBest < 150) return 'slightly_worse';
  if (gapFromBest < 350) return 'worse';
  if (gapFromBest < 700) return 'bad';
  return 'blunder';
}

function rankingScore(choice: DraftProblemChoice, correctChoice: DraftProblemChoice): number {
  if (isFiniteNumber(choice.eval_percent)) return choice.eval_percent;
  if (isFiniteNumber(choice.eval_cp) && isFiniteNumber(correctChoice.eval_cp)) {
    return -Math.abs(choice.eval_cp - correctChoice.eval_cp);
  }
  return choice.choice_id === correctChoice.choice_id ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

export function extractEvalFeatures(
  problem: DraftProblem,
  choices: DraftProblemChoice[],
): ChoiceEvalFeature[] {
  const correctChoice = choices.find((choice) => choice.choice_id === problem.correct_choice_id) ?? choices[0];
  const correctEvalCp = correctChoice?.eval_cp;
  const rankedChoiceIds = [...choices]
    .sort((a, b) => rankingScore(b, correctChoice) - rankingScore(a, correctChoice))
    .map((choice) => choice.choice_id);

  return choices.map((choice) => {
    const gapFromBest = isFiniteNumber(choice.eval_cp) && isFiniteNumber(correctEvalCp)
      ? Math.abs(correctEvalCp - choice.eval_cp)
      : choice.choice_id === problem.correct_choice_id
        ? 0
        : null;

    return {
      choice_id: choice.choice_id,
      rank: rankedChoiceIds.indexOf(choice.choice_id) + 1,
      gapFromBest,
      quality: classifyQuality(gapFromBest),
      isCorrect: choice.choice_id === problem.correct_choice_id,
    };
  });
}
