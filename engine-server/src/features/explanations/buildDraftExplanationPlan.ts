import type {
  ChoiceEvalFeature,
  DraftChoiceContrastFeatures,
  DraftLineContinuationFeatures,
  DraftLineTrajectoryFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblem,
  DraftProblemChoice,
  ExplanationPlan,
  ExplanationPlanPrimaryReason,
  ExplanationPlanTone,
  LineFactsSummary,
} from './types.js';
import { extractDraftMoveFactsForChoices } from './extractDraftMoveFacts.js';
import { extractDraftPositionFeaturesForChoices } from './extractDraftPositionFeatures.js';
import { extractDraftLineContinuationFeaturesForChoices } from './extractDraftLineContinuationFeatures.js';
import { extractDraftContrastFeaturesForChoices } from './extractDraftContrastFeatures.js';
import { extractDraftLineTrajectoryFeaturesForChoices } from './extractDraftLineTrajectoryFeatures.js';

function getFeature(features: ChoiceEvalFeature[], choiceId: number): ChoiceEvalFeature {
  const feature = features.find((item) => item.choice_id === choiceId);
  if (!feature) {
    throw new Error(`missing eval feature for choice_id=${choiceId}`);
  }
  return feature;
}

function getCorrectChoice(problem: DraftProblem, choices: DraftProblemChoice[]): DraftProblemChoice {
  const correctChoice = choices.find((choice) => choice.choice_id === problem.correct_choice_id);
  if (!correctChoice) {
    throw new Error(`missing correct choice: choice_id=${problem.correct_choice_id}`);
  }
  return correctChoice;
}

function normalizeLine(choice: DraftProblemChoice): string[] {
  const line = Array.isArray(choice.line) ? choice.line.filter((move) => typeof move === 'string' && move.length > 0) : [];

  if (line.length === 0) return [choice.usi];

  if (line[0] === choice.usi) return line;

  return [choice.usi, ...line];
}

function summarizeLineFacts(choice: DraftProblemChoice): LineFactsSummary {
  const line = normalizeLine(choice);
  const firstSixMoves = line.slice(0, 6);

  const dropPieces = line
    .filter((move) => move.includes('*'))
    .map((move) => move.split('*')[0])
    .filter(Boolean);

  const promotedMoves = line.filter((move) => move.endsWith('+'));

  return {
    firstResponse: line.length >= 2 ? line[1] : null,
    firstSixMoves,
    moveCount: line.length,
    hasDrop: dropPieces.length > 0,
    hasPromotion: promotedMoves.length > 0,
    dropPieces,
    promotedMoves,
  };
}

function sharedLineMoves(a: DraftProblemChoice, b: DraftProblemChoice): string[] {
  const lineA = normalizeLine(a);
  const lineB = normalizeLine(b);
  const result: string[] = [];

  const maxLength = Math.min(lineA.length, lineB.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (lineA[index] !== lineB[index]) break;
    result.push(lineA[index]);
  }

  return result;
}

function absNumberDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function planTone(feature: ChoiceEvalFeature): ExplanationPlanTone {
  if (feature.isCorrect) {
    return 'positive';
  }

  const gap = feature.gapFromBest;

  if (gap === null) return 'mild_negative';
  if (gap <= 120) return 'mild_negative';
  if (gap <= 450) return 'clear_negative';
  return 'severe_negative';
}

function planConfidence(primaryReason: ExplanationPlanPrimaryReason): ExplanationPlan['confidence'] {
  if (primaryReason === 'unknown') return 'low';

  if (
    primaryReason === 'correct_attack_continues' ||
    primaryReason === 'wrong_natural_but_worse' ||
    primaryReason === 'wrong_attack_disappears'
  ) {
    return 'medium';
  }

  return 'medium';
}

function inferCorrectPrimaryReason(
  choice: DraftProblemChoice,
  feature: ChoiceEvalFeature,
  lineFacts: LineFactsSummary,
): ExplanationPlanPrimaryReason {
  if (!feature.isCorrect) {
    throw new Error('inferCorrectPrimaryReason called with wrong choice');
  }

  if (lineFacts.hasPromotion || lineFacts.hasDrop) {
    return 'correct_tactical_gain';
  }

  if (lineFacts.moveCount >= 5) {
    return 'correct_forcing_sequence';
  }

  if (choice.eval_cp !== null || choice.eval_percent !== null) {
    return 'correct_attack_continues';
  }

  return 'unknown';
}

function inferWrongPrimaryReason(params: {
  choice: DraftProblemChoice;
  correctChoice: DraftProblemChoice;
  feature: ChoiceEvalFeature;
  lineFacts: LineFactsSummary;
  correctLineFacts: LineFactsSummary;
  absGapCp: number | null;
  absGapPercent: number | null;
}): ExplanationPlanPrimaryReason {
  const { feature, lineFacts, correctLineFacts, absGapCp, absGapPercent } = params;

  if (feature.isCorrect) {
    throw new Error('inferWrongPrimaryReason called with correct choice');
  }

  if (absGapPercent !== null && absGapPercent <= 5) {
    return 'wrong_natural_but_worse';
  }

  if (feature.gapFromBest !== null && feature.gapFromBest <= 120) {
    return 'wrong_natural_but_worse';
  }

  if (lineFacts.moveCount <= 1) {
    return 'wrong_no_threat';
  }

  if ((correctLineFacts.hasDrop || correctLineFacts.hasPromotion) && !lineFacts.hasDrop && !lineFacts.hasPromotion) {
    return 'wrong_attack_disappears';
  }

  if (absGapCp !== null && absGapCp >= 700) {
    return 'wrong_attack_disappears';
  }

  if (absGapPercent !== null && absGapPercent >= 25) {
    return 'wrong_attack_disappears';
  }

  if (lineFacts.firstResponse !== null) {
    return 'wrong_opponent_escapes';
  }

  return 'unknown';
}

function refinePrimaryReasonWithPositionFeatures(params: {
  primaryReason: ExplanationPlanPrimaryReason;
  isCorrect: boolean;
  positionFeatures: DraftPositionFeatures | undefined;
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined;
  absGapCp: number | null;
  absGapPercent: number | null;
}): ExplanationPlanPrimaryReason {
  const { primaryReason, isCorrect, positionFeatures, lineContinuationFeatures, absGapCp, absGapPercent } = params;
  const hasStrongContinuation = Boolean(lineContinuationFeatures?.continuationPhrases.some((phrase) =>
    phrase.includes('飛車を逃げても角が成れる') ||
    phrase.includes('角成が残る') ||
    phrase.includes('馬を作れる') ||
    phrase.includes('龍を作れる')
  ));

  if (isCorrect && hasStrongContinuation) {
    return 'correct_attack_continues';
  }

  if (!positionFeatures) return primaryReason;

  const hasMaterialPhrase = positionFeatures.material.materialPhrases.length > 0;
  const hasActivityPhrase = positionFeatures.pieceActivity.activityPhrases.length > 0;
  const hasHighValueAttack = positionFeatures.material.attackedHighValuePieces.length > 0;
  const hasMaterialGain = (positionFeatures.material.capturedPieceValue ?? 0) >= 5 || hasHighValueAttack;
  const kingSafetyWorse = positionFeatures.kingSafety.confidence === 'medium'
    && (positionFeatures.kingSafety.ownKingSafetyDelta ?? 0) < 0;

  if (isCorrect) {
    if (hasMaterialGain) return 'correct_material_gain';
    if (hasMaterialPhrase || hasActivityPhrase) return 'correct_tactical_gain';
    if (positionFeatures.kingSafety.confidence === 'medium' && !kingSafetyWorse) return 'correct_defense_works';
    if (hasStrongContinuation) return 'correct_tactical_gain';
    return primaryReason;
  }

  if (kingSafetyWorse) return 'wrong_king_safety_risk';

  const largeGap = (absGapCp !== null && absGapCp >= 450) || (absGapPercent !== null && absGapPercent >= 15);
  if (!hasMaterialPhrase && !hasActivityPhrase && largeGap) return 'wrong_no_threat';

  return primaryReason;
}

function refinePrimaryReasonWithContrastFeatures(params: {
  primaryReason: ExplanationPlanPrimaryReason;
  isCorrect: boolean;
  contrastFeatures: DraftChoiceContrastFeatures | undefined;
}): ExplanationPlanPrimaryReason {
  const { primaryReason, isCorrect, contrastFeatures } = params;
  if (isCorrect || !contrastFeatures || contrastFeatures.confidence === 'none') return primaryReason;

  if (contrastFeatures.diagnosis === 'natural_but_worse') return 'wrong_natural_but_worse';
  if (contrastFeatures.diagnosis === 'slow_pawn_push') return 'wrong_too_slow';
  if (
    contrastFeatures.diagnosis === 'small_gain_but_no_continuation' ||
    contrastFeatures.diagnosis === 'small_gain_but_weaker_than_correct' ||
    contrastFeatures.diagnosis === 'low_value_gain_vs_major_piece_attack' ||
    contrastFeatures.diagnosis === 'attacks_piece_but_no_followup' ||
    contrastFeatures.diagnosis === 'no_high_value_attack' ||
    contrastFeatures.diagnosis === 'no_tactical_followup' ||
    contrastFeatures.diagnosis === 'no_continuation_compared_to_correct'
  ) {
    return 'wrong_attack_disappears';
  }
  if (
    contrastFeatures.diagnosis === 'weaker_material_gain' ||
    contrastFeatures.diagnosis === 'promotion_or_capture_missing'
  ) return 'wrong_material_loss';
  if (contrastFeatures.diagnosis === 'quiet_move_with_large_eval_gap') return 'wrong_too_slow';
  if (contrastFeatures.diagnosis === 'king_safety_risk') return 'wrong_king_safety_risk';

  return primaryReason;
}

function refinePrimaryReasonWithLineTrajectoryFeatures(params: {
  primaryReason: ExplanationPlanPrimaryReason;
  isCorrect: boolean;
  lineTrajectoryFeatures: DraftLineTrajectoryFeatures | undefined;
}): ExplanationPlanPrimaryReason {
  const { primaryReason, isCorrect, lineTrajectoryFeatures } = params;
  if (!isCorrect || !lineTrajectoryFeatures) return primaryReason;

  const continuationEvidence = lineTrajectoryFeatures.correctAttackContinuationEvidence ?? [];
  const usefulContinuation = continuationEvidence.some((item) =>
    item.textUsefulness === 'must_use' ||
    item.textUsefulness === 'useful' ||
    item.category === 'lineContinuation' ||
    item.category === 'threat' ||
    item.category === 'promotion' ||
    item.category === 'pieceActivity'
  );
  const materialAndActivity = lineTrajectoryFeatures.usableEvidence.some((item) => item.category === 'material' && item.confidence !== 'low') &&
    lineTrajectoryFeatures.usableEvidence.some((item) => item.category === 'pieceActivity' && item.confidence !== 'low');

  if (usefulContinuation || materialAndActivity) return 'correct_attack_continues';
  return primaryReason;
}

function addContrastEvidenceToLineTrajectory(
  lineTrajectoryFeatures: DraftLineTrajectoryFeatures | undefined,
  contrastFeatures: DraftChoiceContrastFeatures | undefined,
  feature: ChoiceEvalFeature | undefined,
): void {
  if (!lineTrajectoryFeatures || !contrastFeatures || contrastFeatures.confidence === 'none') return;

  const existing = new Set(lineTrajectoryFeatures.usableEvidence.map((item) => item.phrase));
  const phrases = [
    ...contrastFeatures.contrastUsablePhrases,
    ...contrastFeatures.contrastPhrases,
    ...contrastFeatures.missingComparedToCorrect,
  ];
  for (const phrase of phrases) {
    const normalized = phrase.trim();
    if (!normalized || existing.has(normalized)) continue;
    existing.add(normalized);
    lineTrajectoryFeatures.usableEvidence.push({
      category: 'contrast',
      phrase: normalized,
      evidenceLevel: contrastFeatures.confidence === 'medium' ? 'eval_supported' : 'weak',
      confidence: contrastFeatures.confidence === 'medium' ? 'medium' : 'low',
      source: 'contrast_features',
      evalSupport: feature?.isCorrect
        ? 'positive'
        : feature?.quality === 'bad' || feature?.quality === 'blunder' || (feature?.gapFromBest ?? 0) >= 200
          ? 'negative'
          : 'neutral',
    });
  }
}

function buildReasonDetail(params: {
  choice: DraftProblemChoice;
  isCorrect: boolean;
  primaryReason: ExplanationPlanPrimaryReason;
  lineFacts: LineFactsSummary;
  correctLineFacts: LineFactsSummary;
  absGapCp: number | null;
  absGapPercent: number | null;
  contrastFeatures: DraftChoiceContrastFeatures | undefined;
  lineTrajectoryFeatures: DraftLineTrajectoryFeatures | undefined;
}): string {
  const { isCorrect, primaryReason, contrastFeatures, lineTrajectoryFeatures } = params;

  if (isCorrect) {
    const continuationPhrase = lineTrajectoryFeatures?.correctAttackContinuationEvidence.find((item) =>
      item.textUsefulness === 'must_use' || item.textUsefulness === 'useful'
    )?.usablePhrase ?? lineTrajectoryFeatures?.correctAttackContinuationEvidence[0]?.usablePhrase;

    if (primaryReason === 'correct_tactical_gain') {
      return '飛車や角に当たる';
    }

    if (primaryReason === 'correct_forcing_sequence') {
      return '相手の応手が限られる';
    }

    if (primaryReason === 'correct_attack_continues') {
      return continuationPhrase ?? '具体的な次の狙いが残る';
    }

    if (primaryReason === 'correct_defense_works') {
      return '受けながら形を良くする';
    }

    if (primaryReason === 'correct_material_gain') {
      return '一歩得や駒得につながる';
    }

    return '読み筋から短く書く';
  }

  const contrastMemo = contrastFeatures?.contrastPhrases[0];
  if (!isCorrect && contrastMemo) return contrastMemo;

  if (primaryReason === 'wrong_natural_but_worse') {
    return '狙いはあるが十分でない';
  }

  if (primaryReason === 'wrong_no_threat') {
    return '厳しい狙いがない';
  }

  if (primaryReason === 'wrong_attack_disappears') {
    return '攻め筋が消える';
  }

  if (primaryReason === 'wrong_opponent_escapes') {
    return '正解手ほど攻めが続かない';
  }

  if (primaryReason === 'wrong_too_slow') {
    return '手が遅い';
  }

  if (primaryReason === 'wrong_material_loss') {
    return '駒損になる';
  }

  if (primaryReason === 'wrong_gives_pieces') {
    return '駒を渡して危ない';
  }

  if (primaryReason === 'wrong_king_safety_risk') {
    return '自玉が危ない';
  }

  return '読み筋から短く書く';
}

function suggestedStructure(primaryReason: ExplanationPlanPrimaryReason, isCorrect: boolean): string[] {
  if (isCorrect) {
    return [
      '狙いを一言で書く',
      'lineの具体手を必要なら1つ入れる',
      '具体的な駒名や攻めの継続で短く締める',
    ];
  }

  if (primaryReason === 'wrong_natural_but_worse') {
    return [
      '狙いはあると短く書く',
      '足りない点を一言で書く',
      '疑問手または選びにくいで締める',
    ];
  }

  if (primaryReason === 'wrong_opponent_escapes') {
    return [
      '狙いを短く書く',
      '逃げた根拠がなければ正解手ほど攻めが続かないと書く',
      '読み筋にない断定は避ける',
    ];
  }

  if (primaryReason === 'wrong_attack_disappears') {
    return [
      '狙いを短く書く',
      '攻め筋が消える理由を書く',
      '読み筋にない断定は避ける',
    ];
  }

  return [
    '問題点を一言で書く',
    'lineの具体手を必要なら1つ入れる',
    'lineにない変化を作らない',
  ];
}

function hasEscapePhraseEvidence(
  moveFacts: DraftMoveFacts | undefined,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  return [
    ...(moveFacts?.firstResponseFacts ?? []),
    ...(moveFacts?.factPhrases ?? []),
    ...(lineContinuationFeatures?.continuationPhrases ?? []),
  ].some((phrase) =>
    phrase.includes('逃げられる') ||
    phrase.includes('逃げる') ||
    phrase.includes('逃げても') ||
    phrase.includes('かわされる')
  );
}

function allowedPhrases(
  primaryReason: ExplanationPlanPrimaryReason,
  isCorrect: boolean,
  canUseEscapePhrase: boolean,
): string[] {
  if (isCorrect) {
    return ['飛車取り', '角成が残る', '馬を作れる', '龍を作れる', '一歩取れる', '金に当たる'];
  }

  if (primaryReason === 'wrong_natural_but_worse') {
    return ['一見よさそうだが', '狙いはあるが', '次善手', '選びにくい'];
  }

  if (primaryReason === 'wrong_opponent_escapes') {
    if (canUseEscapePhrase) {
      return ['逃げられる', 'かわされる', '攻め味がなくなる', '正解手ほど攻めが続かない'];
    }
    return ['正解手ほど攻めが続かない', '攻め味が弱い', '攻め味が薄い', '手が続かない'];
  }

  if (primaryReason === 'wrong_attack_disappears') {
    return ['攻め筋が消える', '攻め味がなくなる', '手が続かない', 'もったいない'];
  }

  if (primaryReason === 'wrong_no_threat') {
    return ['何もない', '厳しい攻めがない', '主張が弱い', '物足りない'];
  }

  if (primaryReason === 'wrong_too_slow') {
    return ['遅い', '重たい', '一手パス', '間に合わない'];
  }

  if (primaryReason === 'wrong_material_loss') {
    return ['駒損', '交換で損', '精算される', '損をする'];
  }

  if (primaryReason === 'wrong_gives_pieces') {
    return ['駒を渡す', '相手の攻めが厳しい', '自玉が危ない'];
  }

  if (primaryReason === 'wrong_king_safety_risk') {
    return ['玉が薄い', '自玉が危ない', '受けにくい'];
  }

  return ['正解手と比べると', '疑問手', '選びにくい'];
}

function avoidPhrases(): string[] {
  return [
    '詰みです',
    '必至です',
    '詰めろです',
    '完全に負けです',
    '絶対に悪手です',
    '評価値は',
    '勝率は',
  ];
}

export function buildDraftExplanationPlansForProblem(
  problem: DraftProblem,
  choices: DraftProblemChoice[],
  features: ChoiceEvalFeature[],
): ExplanationPlan[] {
  const sortedChoices = [...choices].sort((a, b) => a.choice_id - b.choice_id);
  const correctChoice = getCorrectChoice(problem, sortedChoices);
  const correctLineFacts = summarizeLineFacts(correctChoice);
  const moveFactsByChoiceId = new Map<number, DraftMoveFacts>(
    extractDraftMoveFactsForChoices(problem, sortedChoices).map((facts) => [facts.choiceId, facts]),
  );
  const positionFeaturesByChoiceId = new Map<number, DraftPositionFeatures>(
    extractDraftPositionFeaturesForChoices(problem, sortedChoices).map((featuresForChoice) => [
      featuresForChoice.choiceId,
      featuresForChoice,
    ]),
  );
  const lineContinuationFeaturesByChoiceId = new Map<number, DraftLineContinuationFeatures>(
    extractDraftLineContinuationFeaturesForChoices(problem, sortedChoices).map((featuresForChoice) => [
      featuresForChoice.choiceId,
      featuresForChoice,
    ]),
  );
  const lineTrajectoryFeaturesByChoiceId = new Map<number, DraftLineTrajectoryFeatures>(
    extractDraftLineTrajectoryFeaturesForChoices({
      problem,
      choices: sortedChoices,
      features,
      moveFactsByChoiceId,
      positionFeaturesByChoiceId,
      lineContinuationFeaturesByChoiceId,
    }).map((featuresForChoice) => [featuresForChoice.choiceId, featuresForChoice]),
  );
  const contrastFeaturesByChoiceId = new Map<number, DraftChoiceContrastFeatures>(
    extractDraftContrastFeaturesForChoices({
      problem,
      choices: sortedChoices,
      features,
      moveFactsByChoiceId,
      positionFeaturesByChoiceId,
      lineContinuationFeaturesByChoiceId,
      lineTrajectoryFeaturesByChoiceId,
    }).map((featuresForChoice) => [featuresForChoice.choiceId, featuresForChoice]),
  );
  for (const choice of sortedChoices) {
    addContrastEvidenceToLineTrajectory(
      lineTrajectoryFeaturesByChoiceId.get(choice.choice_id),
      contrastFeaturesByChoiceId.get(choice.choice_id),
      features.find((feature) => feature.choice_id === choice.choice_id),
    );
  }

  return sortedChoices.map((choice) => {
    const feature = getFeature(features, choice.choice_id);
    const lineFacts = summarizeLineFacts(choice);
    const moveFacts = moveFactsByChoiceId.get(choice.choice_id);
    const positionFeatures = positionFeaturesByChoiceId.get(choice.choice_id);
    const lineContinuationFeatures = lineContinuationFeaturesByChoiceId.get(choice.choice_id);
    const lineTrajectoryFeatures = lineTrajectoryFeaturesByChoiceId.get(choice.choice_id);
    const contrastFeatures = contrastFeaturesByChoiceId.get(choice.choice_id);
    const isCorrect = feature.isCorrect;

    const absGapCp = absNumberDiff(correctChoice.eval_cp, choice.eval_cp);
    const absGapPercent = absNumberDiff(correctChoice.eval_percent, choice.eval_percent);

    const inferredPrimaryReason = isCorrect
      ? inferCorrectPrimaryReason(choice, feature, lineFacts)
      : inferWrongPrimaryReason({
          choice,
          correctChoice,
          feature,
          lineFacts,
          correctLineFacts,
          absGapCp,
          absGapPercent,
        });
    const positionRefinedPrimaryReason = refinePrimaryReasonWithPositionFeatures({
      primaryReason: inferredPrimaryReason,
      isCorrect,
      positionFeatures,
      lineContinuationFeatures,
      absGapCp,
      absGapPercent,
    });
    const lineTrajectoryRefinedPrimaryReason = refinePrimaryReasonWithLineTrajectoryFeatures({
      primaryReason: positionRefinedPrimaryReason,
      isCorrect,
      lineTrajectoryFeatures,
    });
    const primaryReason = refinePrimaryReasonWithContrastFeatures({
      primaryReason: lineTrajectoryRefinedPrimaryReason,
      isCorrect,
      contrastFeatures,
    });
    const canUseEscapePhrase = hasEscapePhraseEvidence(moveFacts, lineContinuationFeatures);

    const tone = planTone(feature);

    return {
      problemId: problem.id,
      displayNo: null,
      choiceId: choice.choice_id,
      isCorrect,
      label: choice.label,
      usi: choice.usi,

      primaryReason,
      secondaryReasons: [],

      reasonDetail: buildReasonDetail({
        choice,
        isCorrect,
        primaryReason,
        lineFacts,
        correctLineFacts,
        absGapCp,
        absGapPercent,
        contrastFeatures,
        lineTrajectoryFeatures,
      }),
      tone,

      confidence: planConfidence(primaryReason),

      suggestedStructure: suggestedStructure(primaryReason, isCorrect),
      allowedPhrases: allowedPhrases(primaryReason, isCorrect, canUseEscapePhrase),
      avoidPhrases: avoidPhrases(),

      sourceSignals: {
        suspectedPatterns: [],
        textLabelsSummary: [],
        lineFactsSummary: [
          `firstResponse=${lineFacts.firstResponse ?? 'none'}`,
          `moveCount=${lineFacts.moveCount}`,
          `hasDrop=${lineFacts.hasDrop}`,
          `hasPromotion=${lineFacts.hasPromotion}`,
        ],
        absGapCp,
        absGapPercent,
        firstResponse: lineFacts.firstResponse,
        sharedLineMoves: sharedLineMoves(choice, correctChoice),
        moveFacts,
        positionFeatures,
        lineContinuationFeatures,
        lineTrajectoryFeatures,
        contrastFeatures,
      },
    };
  });
}
