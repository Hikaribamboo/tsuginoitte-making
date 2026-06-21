import type {
  ChoiceComparisonFacts,
  ExplanationTextLabels,
  LineFacts,
  SuspectedExplanationPattern,
} from './types.js';

export function classifyExplanationPatterns(input: {
  isCorrect: boolean;
  explanation: string;
  textLabels: ExplanationTextLabels;
  lineFacts: LineFacts;
  comparisonToCorrect: ChoiceComparisonFacts | null;
}): SuspectedExplanationPattern[] {
  const patterns: SuspectedExplanationPattern[] = [];
  const { isCorrect, textLabels } = input;
  const explanation = input.explanation ?? '';

  if (isCorrect && textLabels.mentionsAttack && (
    textLabels.saysIntentWorks
    || explanation.includes('狙い')
    || explanation.includes('手筋')
    || explanation.includes('攻め')
  )) patterns.push('attack_continues');
  if (isCorrect && textLabels.mentionsDefense) patterns.push('defense_works');
  if (isCorrect && textLabels.saysMaterialGain) patterns.push('material_gain');
  if (isCorrect && textLabels.mentionsKingSafety && textLabels.saysGoodMove) patterns.push('defense_works');

  if (!isCorrect && (
    textLabels.saysIntentFails
    || explanation.includes('攻め味')
    || explanation.includes('攻め筋')
    || explanation.includes('狙い')
  )) patterns.push('attack_disappears');
  if (!isCorrect && textLabels.saysOpponentCanEscape) patterns.push('opponent_escapes');
  if (!isCorrect && (
    textLabels.saysOpponentCanBlock
    || (
      textLabels.mentionsLineControl
      && (textLabels.saysIntentFails || textLabels.saysOpponentCanDefend)
    )
  )) patterns.push('opponent_blocks_line');
  if (!isCorrect && (textLabels.saysTooSlow || textLabels.saysOneMovePass)) patterns.push('too_slow');
  if (textLabels.saysMaterialGain) patterns.push('material_gain');
  if (!isCorrect && textLabels.saysMaterialLoss) patterns.push('material_loss');
  if (!isCorrect && textLabels.saysGivesPieces) patterns.push('gives_pieces');
  if (textLabels.mentionsKingSafety && !isCorrect) patterns.push('king_safety_risk');
  if (!isCorrect && textLabels.saysNoThreat) patterns.push('no_threat');
  if (!isCorrect && (
    textLabels.saysNaturalBut
    || explanation.includes('見える')
    || explanation.includes('狙いがある')
    || textLabels.saysBadMove
    || textLabels.saysQuestionable
  )) patterns.push('natural_but_worse');
  // TODO: natural_but_worse を以下に分解する
  // - natural_but_attack_disappears
  // - natural_but_opponent_escapes
  // - natural_but_no_threat
  // - natural_but_king_safety_risk
  // - natural_but_material_loss
  // - natural_but_too_slow
  if (!isCorrect && explanation.trim().length > 0 && explanation.trim().length <= 8 && textLabels.saysBadMove) {
    patterns.push('bad_move_short');
  }

  return patterns.length > 0 ? Array.from(new Set(patterns)) : ['unknown'];
}
