import type {
  ChoiceEvalFeature,
  DraftChoiceContrastDiagnosis,
  DraftChoiceContrastFeatures,
  DraftLineContinuationFeatures,
  DraftLineTrajectoryFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblem,
  DraftProblemChoice,
} from './types.js';

function unique(items: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizePhrase(item ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizePhrase(phrase: string): string {
  const trimmed = phrase.trim();
  if (trimmed === '歩を取れる') return '一歩取れる';
  if (trimmed === '飛車を逃げても角が成れる') return '飛車を逃げても角成が残る';
  if (trimmed === '角が成れる') return '角成が残る';
  return trimmed;
}

function strengthPhrases(params: {
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineContinuationFeatures?: DraftLineContinuationFeatures;
  includeContinuationFirst?: boolean;
}): string[] {
  const continuation = params.lineContinuationFeatures?.continuationPhrases ?? [];
  const facts = params.moveFacts?.factPhrases ?? [];
  const material = params.positionFeatures?.material.materialPhrases ?? [];
  const activity = params.positionFeatures?.pieceActivity.activityPhrases ?? [];

  return params.includeContinuationFirst
    ? unique([...continuation, ...facts, ...material, ...activity])
    : unique([...facts, ...material, ...activity, ...continuation]);
}

function trajectoryStrengthPhrases(lineTrajectoryFeatures?: DraftLineTrajectoryFeatures): string[] {
  return unique([
    ...(lineTrajectoryFeatures?.materialTrend.phrases ?? []),
    ...(lineTrajectoryFeatures?.pieceActivityTrend.phrases ?? []),
    ...(lineTrajectoryFeatures?.evidenceChains
      .filter((chain) => chain.confidence !== 'low' && chain.evidenceLevel !== 'weak')
      .map((chain) => chain.usablePhrase) ?? []),
    ...(lineTrajectoryFeatures?.usableEvidence
      .filter((item) => item.confidence !== 'low' && item.evidenceLevel !== 'weak')
      .map((item) => item.phrase) ?? []),
  ]);
}

function hasChainCategory(lineTrajectoryFeatures: DraftLineTrajectoryFeatures | undefined, category: DraftLineTrajectoryFeatures['evidenceChains'][number]['category']): boolean {
  return Boolean(lineTrajectoryFeatures?.evidenceChains.some((chain) =>
    chain.category === category &&
    chain.confidence !== 'low'
  ));
}

function hasHighValueAttack(moveFacts?: DraftMoveFacts, positionFeatures?: DraftPositionFeatures): boolean {
  return Boolean(
    moveFacts?.attacksHighValuePiece ||
    (positionFeatures?.material.attackedHighValuePieces.length ?? 0) > 0 ||
    positionFeatures?.pieceActivity.attacksHighValuePiece,
  );
}

function hasContinuation(lineContinuationFeatures?: DraftLineContinuationFeatures): boolean {
  return (lineContinuationFeatures?.continuationPhrases.length ?? 0) > 0 ||
    (lineContinuationFeatures?.nextOwnMoveFacts.length ?? 0) > 0 ||
    Boolean(lineContinuationFeatures?.movedPieceContinuesAfterResponse);
}

function hasPromotionContinuation(lineContinuationFeatures?: DraftLineContinuationFeatures): boolean {
  return Boolean(
    lineContinuationFeatures?.movedPiecePromotesAfterResponse ||
    lineContinuationFeatures?.continuationPhrases.some((phrase) =>
      phrase.includes('角成') ||
      phrase.includes('成れる') ||
      phrase.includes('馬を作れる') ||
      phrase.includes('龍を作れる')
    ),
  );
}

function isSmallGain(moveFacts?: DraftMoveFacts, positionFeatures?: DraftPositionFeatures): boolean {
  return moveFacts?.capturedPiece === '歩' ||
    positionFeatures?.material.capturedPiece === '歩' ||
    positionFeatures?.summaryPhrases.some((phrase) => phrase === '歩を取れる' || phrase === '一歩取れる') === true;
}

function isPawnPushOnly(moveFacts?: DraftMoveFacts, positionFeatures?: DraftPositionFeatures): boolean {
  return moveFacts?.movedPiece === '歩' &&
    !moveFacts.capturedPiece &&
    !hasHighValueAttack(moveFacts, positionFeatures) &&
    !positionFeatures?.material.materialPhrases.length;
}

function isQuietMove(moveFacts?: DraftMoveFacts, positionFeatures?: DraftPositionFeatures, lineContinuationFeatures?: DraftLineContinuationFeatures): boolean {
  return !moveFacts?.capturedPiece &&
    !hasHighValueAttack(moveFacts, positionFeatures) &&
    !hasContinuation(lineContinuationFeatures) &&
    (positionFeatures?.material.roughImmediateMaterialGain ?? 0) <= 0;
}

function largeGap(feature?: ChoiceEvalFeature): boolean {
  return feature?.quality === 'bad' ||
    feature?.quality === 'blunder' ||
    (feature?.gapFromBest !== null && feature?.gapFromBest !== undefined && feature.gapFromBest >= 250);
}

function hasPromotionOrCaptureContinuation(lineContinuationFeatures?: DraftLineContinuationFeatures): boolean {
  return Boolean(
    lineContinuationFeatures?.movedPiecePromotesAfterResponse ||
    lineContinuationFeatures?.movedPieceCapturesAfterResponse ||
    lineContinuationFeatures?.nextOwnMoveFacts.some((phrase) =>
      phrase.includes('取れる') ||
      phrase.includes('成れる') ||
      phrase.includes('馬を作れる') ||
      phrase.includes('龍を作れる')
    ),
  );
}

function materialGain(positionFeatures?: DraftPositionFeatures): number {
  return positionFeatures?.material.roughImmediateMaterialGain ?? 0;
}

function hasKingSafetyRisk(positionFeatures?: DraftPositionFeatures): boolean {
  return Boolean(
    positionFeatures?.kingSafety.confidence === 'medium' &&
    (positionFeatures.kingSafety.ownKingSafetyDelta ?? 0) < 0,
  );
}

function firstOwnStrength(ownStrengths: string[]): string | null {
  return ownStrengths.find((phrase) =>
    phrase.includes('一歩取れる') ||
    phrase.includes('桂') ||
    phrase.includes('銀') ||
    phrase.includes('金') ||
    phrase.includes('角') ||
    phrase.includes('飛車')
  ) ?? ownStrengths[0] ?? null;
}

function missingPhrases(params: {
  correctMoveFacts?: DraftMoveFacts;
  ownMoveFacts?: DraftMoveFacts;
  correctPositionFeatures?: DraftPositionFeatures;
  ownPositionFeatures?: DraftPositionFeatures;
  correctLineContinuationFeatures?: DraftLineContinuationFeatures;
  ownLineContinuationFeatures?: DraftLineContinuationFeatures;
  correctLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
  ownLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
}): string[] {
  const result: string[] = [];
  const correctHasContinuation = hasContinuation(params.correctLineContinuationFeatures);
  const ownHasContinuation = hasContinuation(params.ownLineContinuationFeatures);
  const correctHasHighValueAttack = hasHighValueAttack(params.correctMoveFacts, params.correctPositionFeatures);
  const ownHasHighValueAttack = hasHighValueAttack(params.ownMoveFacts, params.ownPositionFeatures);
  const correctTrajectoryHasAttack = (params.correctLineTrajectoryFeatures?.pieceActivityTrend.phrases.length ?? 0) > 0;
  const ownTrajectoryHasAttack = (params.ownLineTrajectoryFeatures?.pieceActivityTrend.phrases.length ?? 0) > 0;
  const correctTrajectoryHasMaterial = (params.correctLineTrajectoryFeatures?.materialTrend.phrases.length ?? 0) > 0;
  const ownTrajectoryHasMaterial = (params.ownLineTrajectoryFeatures?.materialTrend.phrases.length ?? 0) > 0;
  const correctHasLineChain = hasChainCategory(params.correctLineTrajectoryFeatures, 'lineContinuation');
  const ownHasLineChain = hasChainCategory(params.ownLineTrajectoryFeatures, 'lineContinuation');
  const correctHasMaterialChain = hasChainCategory(params.correctLineTrajectoryFeatures, 'material');
  const ownHasMaterialChain = hasChainCategory(params.ownLineTrajectoryFeatures, 'material');
  const correctHasDefenseChain = hasChainCategory(params.correctLineTrajectoryFeatures, 'defense');
  const ownHasDefenseChain = hasChainCategory(params.ownLineTrajectoryFeatures, 'defense');

  if ((correctHasContinuation || correctTrajectoryHasAttack || correctHasLineChain) && !ownHasContinuation && !ownTrajectoryHasAttack && !ownHasLineChain) {
    result.push('正解手のような後続の攻めがない');
  }
  if ((correctHasHighValueAttack || correctTrajectoryHasAttack) && !ownHasHighValueAttack && !ownTrajectoryHasAttack) {
    result.push('正解手ほど大きな当たりがない');
  }
  if ((correctTrajectoryHasMaterial || correctHasMaterialChain) && !ownTrajectoryHasMaterial && !ownHasMaterialChain) {
    result.push('正解手ほど駒得につながる手順がない');
  }
  if (correctHasDefenseChain && !ownHasDefenseChain) {
    result.push('正解手ほど受けの手順が見えない');
  }
  if (hasPromotionContinuation(params.correctLineContinuationFeatures) && !hasPromotionContinuation(params.ownLineContinuationFeatures)) {
    result.push('正解手のような角成が残らない');
  }
  if (
    hasPromotionOrCaptureContinuation(params.correctLineContinuationFeatures) &&
    !hasPromotionOrCaptureContinuation(params.ownLineContinuationFeatures) &&
    !result.includes('正解手のような角成が残らない')
  ) {
    result.push('正解手のような成りや駒得が残らない');
  }

  return unique(result);
}

function diagnose(params: {
  feature?: ChoiceEvalFeature;
  correctMoveFacts?: DraftMoveFacts;
  ownMoveFacts?: DraftMoveFacts;
  correctPositionFeatures?: DraftPositionFeatures;
  ownPositionFeatures?: DraftPositionFeatures;
  correctLineContinuationFeatures?: DraftLineContinuationFeatures;
  ownLineContinuationFeatures?: DraftLineContinuationFeatures;
  correctLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
  ownLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
}): DraftChoiceContrastDiagnosis {
  if (params.feature?.isCorrect) return 'unclear';
  if (hasKingSafetyRisk(params.ownPositionFeatures)) return 'king_safety_risk';

  const correctHasContinuation = hasContinuation(params.correctLineContinuationFeatures);
  const ownHasContinuation = hasContinuation(params.ownLineContinuationFeatures);
  const ownHasHighValueAttack = hasHighValueAttack(params.ownMoveFacts, params.ownPositionFeatures);
  const correctHasHighValueAttack = hasHighValueAttack(params.correctMoveFacts, params.correctPositionFeatures);
  const correctHasPromotionOrCapture = hasPromotionOrCaptureContinuation(params.correctLineContinuationFeatures);
  const ownHasPromotionOrCapture = hasPromotionOrCaptureContinuation(params.ownLineContinuationFeatures);
  const correctTrajectoryHasAttack = (params.correctLineTrajectoryFeatures?.pieceActivityTrend.phrases.length ?? 0) > 0;
  const ownTrajectoryHasAttack = (params.ownLineTrajectoryFeatures?.pieceActivityTrend.phrases.length ?? 0) > 0;
  const correctTrajectoryHasMaterial = (params.correctLineTrajectoryFeatures?.materialTrend.phrases.length ?? 0) > 0;
  const ownTrajectoryHasMaterial = (params.ownLineTrajectoryFeatures?.materialTrend.phrases.length ?? 0) > 0;
  const correctHasLineChain = hasChainCategory(params.correctLineTrajectoryFeatures, 'lineContinuation');
  const ownHasLineChain = hasChainCategory(params.ownLineTrajectoryFeatures, 'lineContinuation');
  const correctHasMaterialChain = hasChainCategory(params.correctLineTrajectoryFeatures, 'material');
  const ownHasMaterialChain = hasChainCategory(params.ownLineTrajectoryFeatures, 'material');

  if (isSmallGain(params.ownMoveFacts, params.ownPositionFeatures) && correctHasHighValueAttack && !ownHasHighValueAttack) {
    return 'low_value_gain_vs_major_piece_attack';
  }
  if (isSmallGain(params.ownMoveFacts, params.ownPositionFeatures) && correctHasContinuation && !ownHasContinuation) {
    return 'small_gain_but_no_continuation';
  }
  if (isSmallGain(params.ownMoveFacts, params.ownPositionFeatures) && largeGap(params.feature)) {
    return 'small_gain_but_weaker_than_correct';
  }
  if (isPawnPushOnly(params.ownMoveFacts, params.ownPositionFeatures) && largeGap(params.feature)) {
    return 'quiet_move_with_large_eval_gap';
  }
  if (isPawnPushOnly(params.ownMoveFacts, params.ownPositionFeatures)) return 'slow_pawn_push';
  if (ownHasHighValueAttack && correctHasContinuation && !ownHasContinuation) {
    return 'attacks_piece_but_no_followup';
  }
  if ((correctHasHighValueAttack || correctTrajectoryHasAttack) && !ownHasHighValueAttack && !ownTrajectoryHasAttack) return 'no_high_value_attack';
  if ((correctHasContinuation || correctTrajectoryHasAttack || correctHasLineChain) && !ownHasContinuation && !ownTrajectoryHasAttack && !ownHasLineChain) return 'no_continuation_compared_to_correct';
  if ((correctHasPromotionOrCapture || correctTrajectoryHasMaterial || correctHasMaterialChain) && !ownHasPromotionOrCapture && !ownTrajectoryHasMaterial && !ownHasMaterialChain) return 'promotion_or_capture_missing';
  if (
    materialGain(params.correctPositionFeatures) > materialGain(params.ownPositionFeatures) &&
    (correctHasHighValueAttack || correctHasContinuation)
  ) {
    return 'weaker_material_gain';
  }
  if (isQuietMove(params.ownMoveFacts, params.ownPositionFeatures, params.ownLineContinuationFeatures) && largeGap(params.feature)) {
    return 'quiet_move_with_large_eval_gap';
  }

  return 'unclear';
}

function contrastPhrases(params: {
  diagnosis: DraftChoiceContrastDiagnosis;
  ownStrengths: string[];
  missingComparedToCorrect: string[];
  ownMoveFacts?: DraftMoveFacts;
}): string[] {
  const own = firstOwnStrength(params.ownStrengths);
  const result: string[] = [];
  const movedPiece = params.ownMoveFacts?.movedPiece;
  const quietMoveSubject = movedPiece
    ? params.ownMoveFacts?.isDrop
      ? `${movedPiece}を打つだけでは`
      : `${movedPiece}を動かすだけでは`
    : 'この手では';

  if (
    params.diagnosis === 'small_gain_but_no_continuation' ||
    params.diagnosis === 'small_gain_but_weaker_than_correct' ||
    params.diagnosis === 'low_value_gain_vs_major_piece_attack'
  ) {
    result.push(`${own ?? '一歩取れる'}が，正解手ほど攻めが続かない`);
  } else if (params.diagnosis === 'slow_pawn_push') {
    result.push('歩を突くだけでは，正解手ほど攻めが続かない');
  } else if (params.diagnosis === 'quiet_move_with_large_eval_gap') {
    result.push(movedPiece === '歩'
      ? '歩を突くだけでは，正解手ほど攻めが続かない'
      : `${quietMoveSubject}，正解手ほど攻めが続かない`);
  } else if (params.diagnosis === 'attacks_piece_but_no_followup') {
    result.push(`${own ?? '駒に当たる'}が，正解手ほど大きな当たりではない`);
  } else if (params.diagnosis === 'no_high_value_attack') {
    result.push('正解手ほど大きな当たりがない');
  } else if (
    params.diagnosis === 'no_tactical_followup' ||
    params.diagnosis === 'no_continuation_compared_to_correct'
  ) {
    result.push('正解手のような後続の攻めがない');
  } else if (params.diagnosis === 'weaker_material_gain') {
    result.push(`${own ?? '当たりはある'}が，正解手ほど大きな当たりではない`);
  } else if (params.diagnosis === 'promotion_or_capture_missing') {
    result.push('正解手のような成りや駒得が残らない');
  } else if (params.diagnosis === 'king_safety_risk') {
    result.push('自玉が危なく，正解手ほど安全に進まない');
  }

  if (params.missingComparedToCorrect.includes('正解手のような角成が残らない')) {
    result.push('正解手のような角成が残らない');
  }

  return unique(result);
}

function confidence(diagnosis: DraftChoiceContrastDiagnosis, contrastPhraseCount: number): DraftChoiceContrastFeatures['confidence'] {
  if (diagnosis === 'unclear') return contrastPhraseCount > 0 ? 'low' : 'none';
  return contrastPhraseCount > 0 ? 'medium' : 'low';
}

export function extractDraftContrastFeaturesForChoices(params: {
  problem: DraftProblem;
  choices: DraftProblemChoice[];
  features: ChoiceEvalFeature[];
  moveFactsByChoiceId: Map<number, DraftMoveFacts>;
  positionFeaturesByChoiceId: Map<number, DraftPositionFeatures>;
  lineContinuationFeaturesByChoiceId: Map<number, DraftLineContinuationFeatures>;
  lineTrajectoryFeaturesByChoiceId?: Map<number, DraftLineTrajectoryFeatures>;
}): DraftChoiceContrastFeatures[] {
  const correctChoiceId = params.problem.correct_choice_id;
  const correctMoveFacts = params.moveFactsByChoiceId.get(correctChoiceId);
  const correctPositionFeatures = params.positionFeaturesByChoiceId.get(correctChoiceId);
  const correctLineContinuationFeatures = params.lineContinuationFeaturesByChoiceId.get(correctChoiceId);
  const correctLineTrajectoryFeatures = params.lineTrajectoryFeaturesByChoiceId?.get(correctChoiceId);
  const correctStrengths = strengthPhrases({
    moveFacts: correctMoveFacts,
    positionFeatures: correctPositionFeatures,
    lineContinuationFeatures: correctLineContinuationFeatures,
    includeContinuationFirst: true,
  }).concat(trajectoryStrengthPhrases(correctLineTrajectoryFeatures));
  const featuresByChoiceId = new Map(params.features.map((feature) => [feature.choice_id, feature]));

  return params.choices.map((choice) => {
    const feature = featuresByChoiceId.get(choice.choice_id);
    const ownMoveFacts = params.moveFactsByChoiceId.get(choice.choice_id);
    const ownPositionFeatures = params.positionFeaturesByChoiceId.get(choice.choice_id);
    const ownLineContinuationFeatures = params.lineContinuationFeaturesByChoiceId.get(choice.choice_id);
    const ownLineTrajectoryFeatures = params.lineTrajectoryFeaturesByChoiceId?.get(choice.choice_id);
    const ownStrengths = strengthPhrases({
      moveFacts: ownMoveFacts,
      positionFeatures: ownPositionFeatures,
      lineContinuationFeatures: ownLineContinuationFeatures,
    }).concat(trajectoryStrengthPhrases(ownLineTrajectoryFeatures));
    const missingComparedToCorrect = feature?.isCorrect
      ? []
      : missingPhrases({
          correctMoveFacts,
          ownMoveFacts,
          correctPositionFeatures,
          ownPositionFeatures,
          correctLineContinuationFeatures,
          ownLineContinuationFeatures,
          correctLineTrajectoryFeatures,
          ownLineTrajectoryFeatures,
        });
    const diagnosis = diagnose({
      feature,
      correctMoveFacts,
      ownMoveFacts,
      correctPositionFeatures,
      ownPositionFeatures,
      correctLineContinuationFeatures,
      ownLineContinuationFeatures,
      correctLineTrajectoryFeatures,
      ownLineTrajectoryFeatures,
    });
    const phrases = feature?.isCorrect ? [] : contrastPhrases({
      diagnosis,
      ownStrengths,
      missingComparedToCorrect,
      ownMoveFacts,
    });

    return {
      choiceId: choice.choice_id,
      comparedToCorrectChoiceId: correctChoiceId,
      correctStrengths,
      ownStrengths,
      missingComparedToCorrect,
      contrastPhrases: phrases,
      diagnosis,
      confidence: confidence(diagnosis, phrases.length),
    };
  });
}
