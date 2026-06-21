import type {
  ChoiceComparisonFacts,
  ExistingExplanationChoice,
  ExistingExplanationProblem,
  ExplanationTextLabels,
  LineFacts,
} from './types.js';

function sharedMoves(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return Array.from(new Set(a.filter((move) => bSet.has(move))));
}

export function compareChoiceToCorrect(input: {
  problem: ExistingExplanationProblem;
  choice: ExistingExplanationChoice;
  correctChoice: ExistingExplanationChoice;
  choiceLineFacts: LineFacts;
  correctLineFacts: LineFacts;
  choiceTextLabels: ExplanationTextLabels;
  correctTextLabels: ExplanationTextLabels;
}): ChoiceComparisonFacts {
  const sharedLineMoves = sharedMoves(input.choice.line, input.correctChoice.line);

  return {
    correctChoiceId: input.correctChoice.choice_id,
    comparedChoiceId: input.choice.choice_id,

    absGapCp: input.choice.abs_gap_from_correct_cp,
    absGapPercent: input.choice.abs_gap_from_correct_percent,

    correctFirstMoves: input.correctLineFacts.firstSixMoves,
    comparedFirstMoves: input.choiceLineFacts.firstSixMoves,

    sameFirstResponseAsCorrect: input.choiceLineFacts.firstResponse !== null
      && input.choiceLineFacts.firstResponse === input.correctLineFacts.firstResponse,
    sharesAnyLineMoveWithCorrect: sharedLineMoves.length > 0,
    sharedLineMoves,

    correctHasPromotion: input.correctLineFacts.hasPromotion,
    comparedHasPromotion: input.choiceLineFacts.hasPromotion,
    correctHasDrop: input.correctLineFacts.hasDrop,
    comparedHasDrop: input.choiceLineFacts.hasDrop,

    comparedFirstResponseMayNeutralize:
      input.choiceTextLabels.saysOpponentCanEscape
      || input.choiceTextLabels.saysOpponentCanBlock
      || input.choiceTextLabels.saysOpponentCanDefend
      || input.choiceTextLabels.saysIntentFails,
  };
}
