import type {
  ChoiceEvalFeature,
  DraftChoiceContrastDiagnosis,
  DraftChoiceContrastFeatures,
  DraftFeatureCategory,
  DraftFeatureEvidenceLevel,
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

type ContrastEvidenceCategory = DraftChoiceContrastFeatures['missingCorrectEvidence'][number]['category'];
type OwnCompensatingEvidence = DraftChoiceContrastFeatures['ownCompensatingEvidence'][number];

function contrastCategory(category: DraftFeatureCategory): ContrastEvidenceCategory | null {
  if (category === 'contrast') return null;
  return category;
}

function contrastEvidenceLevel(evidenceLevel: DraftFeatureEvidenceLevel): DraftChoiceContrastFeatures['missingCorrectEvidence'][number]['evidenceLevel'] | null {
  if (
    evidenceLevel === 'direct' ||
    evidenceLevel === 'line_observed' ||
    evidenceLevel === 'heuristic' ||
    evidenceLevel === 'eval_supported'
  ) return evidenceLevel;
  return null;
}

function usefulCorrectEvidence(lineTrajectoryFeatures?: DraftLineTrajectoryFeatures): DraftChoiceContrastFeatures['missingCorrectEvidence'] {
  const result: DraftChoiceContrastFeatures['missingCorrectEvidence'] = [];
  for (const chain of lineTrajectoryFeatures?.evidenceChains ?? []) {
    const category = contrastCategory(chain.category);
    const evidenceLevel = contrastEvidenceLevel(chain.evidenceLevel);
    if (!category || !evidenceLevel) continue;
    if (chain.confidence === 'low') continue;
    if (chain.textUsefulness === 'avoid' || chain.textUsefulness === 'low_value') continue;
    result.push({
      category,
      phrase: normalizePhrase(chain.usablePhrase || chain.resultPhrase),
      evidenceLevel,
      confidence: chain.confidence,
      source: 'correct_evidenceChain',
      textUsefulness: chain.textUsefulness,
    });
  }
  for (const item of lineTrajectoryFeatures?.usableEvidence ?? []) {
    const category = contrastCategory(item.category);
    const evidenceLevel = contrastEvidenceLevel(item.evidenceLevel);
    if (!category || !evidenceLevel) continue;
    if (item.confidence === 'low') continue;
    if (result.some((existing) => existing.phrase === normalizePhrase(item.phrase))) continue;
    result.push({
      category,
      phrase: normalizePhrase(item.phrase),
      evidenceLevel,
      confidence: item.confidence,
      source: 'correct_usableEvidence',
    });
  }
  return result.filter((item) => item.phrase.length > 0);
}

function hasChainCategory(lineTrajectoryFeatures: DraftLineTrajectoryFeatures | undefined, category: DraftLineTrajectoryFeatures['evidenceChains'][number]['category']): boolean {
  return Boolean(lineTrajectoryFeatures?.evidenceChains.some((chain) =>
    chain.category === category &&
    chain.confidence !== 'low'
  ));
}

function ownEvidenceCategories(params: {
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineContinuationFeatures?: DraftLineContinuationFeatures;
  lineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
}): Set<ContrastEvidenceCategory> {
  const categories = new Set<ContrastEvidenceCategory>();
  if (params.moveFacts?.capturedPiece || (params.positionFeatures?.material.materialPhrases.length ?? 0) > 0) {
    categories.add('material');
  }
  if ((params.moveFacts?.factPhrases.length ?? 0) > 0 || (params.positionFeatures?.pieceActivity.activityPhrases.length ?? 0) > 0) {
    categories.add('pieceActivity');
  }
  if (hasContinuation(params.lineContinuationFeatures)) categories.add('lineContinuation');
  if ((params.positionFeatures?.kingSafety.kingSafetyPhrases.length ?? 0) > 0) categories.add('kingSafety');
  for (const item of params.lineTrajectoryFeatures?.usableEvidence ?? []) {
    const category = contrastCategory(item.category);
    if (category && item.confidence !== 'low' && item.evidenceLevel !== 'weak' && item.evidenceLevel !== 'none') {
      categories.add(category);
    }
  }
  for (const chain of params.lineTrajectoryFeatures?.evidenceChains ?? []) {
    const category = contrastCategory(chain.category);
    if (category && chain.confidence !== 'low' && chain.evidenceLevel !== 'weak' && chain.evidenceLevel !== 'none') {
      categories.add(category);
    }
  }
  return categories;
}

function missingCorrectEvidence(params: {
  correctLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
  ownMoveFacts?: DraftMoveFacts;
  ownPositionFeatures?: DraftPositionFeatures;
  ownLineContinuationFeatures?: DraftLineContinuationFeatures;
  ownLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
}): DraftChoiceContrastFeatures['missingCorrectEvidence'] {
  const ownCategories = ownEvidenceCategories({
    moveFacts: params.ownMoveFacts,
    positionFeatures: params.ownPositionFeatures,
    lineContinuationFeatures: params.ownLineContinuationFeatures,
    lineTrajectoryFeatures: params.ownLineTrajectoryFeatures,
  });
  return usefulCorrectEvidence(params.correctLineTrajectoryFeatures)
    .filter((item) => !ownCategories.has(item.category))
    .slice(0, 4);
}

function categoryFromPhrase(phrase: string): ContrastEvidenceCategory {
  if (phrase.includes('取れる') || phrase.includes('駒得') || phrase.includes('得') || phrase.includes('成')) return 'material';
  if (phrase.includes('当たる') || phrase.includes('取り') || phrase.includes('利き')) return 'pieceActivity';
  if (phrase.includes('受け') || phrase.includes('守')) return 'defense';
  if (phrase.includes('玉') || phrase.includes('王')) return 'kingSafety';
  return 'lineContinuation';
}

function ownStrengthConfidence(phrase: string): OwnCompensatingEvidence['confidence'] {
  if (
    phrase.includes('飛車取り') ||
    phrase.includes('飛車を取れる') ||
    phrase.includes('角を取れる') ||
    phrase.includes('馬を作れる') ||
    phrase.includes('龍を作れる')
  ) return 'high';
  if (
    phrase.includes('一歩取れる') ||
    phrase.includes('取れる') ||
    phrase.includes('当たる') ||
    phrase.includes('当たり') ||
    phrase.includes('成') ||
    phrase.includes('相手玉周辺への利きが増える') ||
    phrase.includes('受け')
  ) return 'medium';
  return 'low';
}

function isUsefulOwnStrengthPhrase(phrase: string): boolean {
  return ownStrengthConfidence(phrase) !== 'low' &&
    !phrase.includes('優勢') &&
    !phrase.includes('有利') &&
    !phrase.includes('必ず') &&
    !phrase.includes('攻め味が弱い') &&
    !phrase.includes('攻めが続かない');
}

function inferredOwnStrengthPhrases(params: {
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineContinuationFeatures?: DraftLineContinuationFeatures;
  lineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
}): string[] {
  const result: string[] = [];
  const capturedPiece = params.moveFacts?.capturedPiece ?? params.positionFeatures?.material.capturedPiece;
  if (capturedPiece === '歩') result.push('一歩取れる');
  else if (capturedPiece) result.push(`${capturedPiece}を取れる`);

  for (const attacked of params.positionFeatures?.material.attackedPieces ?? []) {
    if (['飛車', '角', '金', '銀'].includes(attacked.piece)) {
      result.push(attacked.piece === '飛車' ? '飛車取りになる' : `${attacked.piece}に当たる`);
    }
  }
  for (const attacked of params.moveFacts?.attacksAfterMove ?? []) {
    if (['飛車', '角', '金', '銀'].includes(attacked.piece)) {
      result.push(attacked.piece === '飛車' ? '飛車取りになる' : `${attacked.piece}に当たる`);
    }
  }
  if (params.moveFacts?.isPromotion || params.positionFeatures?.pieceActivity.isPromotion) {
    result.push('成りがある');
  }
  for (const phrase of [
    ...(params.lineContinuationFeatures?.continuationPhrases ?? []),
    ...(params.lineContinuationFeatures?.nextOwnMoveFacts ?? []),
    ...(params.lineTrajectoryFeatures?.materialTrend.phrases ?? []),
    ...(params.lineTrajectoryFeatures?.pieceActivityTrend.phrases ?? []),
    ...(params.lineTrajectoryFeatures?.kingSafetyTrend.phrases ?? []),
    ...(params.lineTrajectoryFeatures?.usableEvidence ?? []).map((item) => item.phrase),
  ]) {
    if (
      phrase.includes('一歩取れる') ||
      phrase.includes('取れる') ||
      phrase.includes('当たる') ||
      phrase.includes('当たり') ||
      phrase.includes('飛車取り') ||
      phrase.includes('馬を作れる') ||
      phrase.includes('龍を作れる') ||
      phrase.includes('角成') ||
      phrase.includes('成り') ||
      phrase.includes('相手玉周辺への利きが増える') ||
      phrase.includes('受け')
    ) {
      result.push(phrase);
    }
  }
  return unique(result).filter(isUsefulOwnStrengthPhrase);
}

function ownCompensatingEvidence(ownStrengths: string[]): DraftChoiceContrastFeatures['ownCompensatingEvidence'] {
  return unique(ownStrengths)
    .filter(isUsefulOwnStrengthPhrase)
    .slice(0, 6)
    .map((phrase) => ({
      category: categoryFromPhrase(phrase),
      phrase,
      confidence: ownStrengthConfidence(phrase),
    }));
}

function missingEvidencePhrase(evidence: DraftChoiceContrastFeatures['missingCorrectEvidence'][number]): string {
  const phrase = evidence.phrase;
  if (phrase.includes('角成') || phrase.includes('角が成') || phrase.includes('馬を作')) {
    return '正解手のような角成が残らない';
  }
  if (phrase.includes('龍を作') || phrase.includes('竜を作') || phrase.includes('飛車成')) {
    return '正解手のような飛車成が残らない';
  }
  if (phrase.includes('飛車取り') || phrase.includes('角取り') || phrase.includes('当たる') || phrase.includes('当たり')) {
    return '正解手ほど大きな当たりではない';
  }
  if (evidence.category === 'material' || phrase.includes('取れる') || phrase.includes('駒得')) {
    return '正解手ほど駒得につながる手順がない';
  }
  if (evidence.category === 'defense') return '正解手ほど受けの手順が見えない';
  if (evidence.category === 'kingSafety') return '正解手ほど玉まわりが安定しない';
  if (evidence.category === 'threat') return '正解手のような厳しい狙いがない';
  return '正解手のような手順付きの継続がない';
}

function concreteMissingEvidencePhrase(evidence: DraftChoiceContrastFeatures['missingCorrectEvidence'][number]): string {
  if (evidence.source !== 'correct_evidenceChain') return missingEvidencePhrase(evidence);
  if (evidence.phrase.length > 36) return missingEvidencePhrase(evidence);
  if (!/[▲△]/.test(evidence.phrase)) return missingEvidencePhrase(evidence);
  return `正解手は${evidence.phrase}が，後続の攻めが弱い`;
}

function contrastUsablePhrases(params: {
  ownCompensatingEvidence: DraftChoiceContrastFeatures['ownCompensatingEvidence'];
  missingCorrectEvidence: DraftChoiceContrastFeatures['missingCorrectEvidence'];
  contrastPhrases: string[];
  missingComparedToCorrect: string[];
}): string[] {
  const missing = unique([
    ...params.missingCorrectEvidence.map(missingEvidencePhrase),
    ...params.missingCorrectEvidence.map(concreteMissingEvidencePhrase),
    ...params.missingComparedToCorrect,
    ...params.contrastPhrases,
  ]);
  const result: string[] = [];
  const own = params.ownCompensatingEvidence.find((item) => item.confidence !== 'low')?.phrase;
  if (own && missing.length > 0) {
    const missingWithoutOwnPrefix = missing.find((phrase) => !phrase.startsWith(`${own}が，`)) ?? missing[0];
    result.push(`${own}が，${missingWithoutOwnPrefix}`);
    if (own.includes('飛車取り')) result.push('飛車取りにはなるが，正解手ほど厳しくない');
    if (own.includes('馬を作れる')) result.push('馬は作れるが，正解手のような継続がない');
    if (own.includes('龍を作れる')) result.push('龍は作れるが，正解手のような継続がない');
    if (own.includes('銀に当たる') || own.includes('金に当たる') || own.includes('角に当たる')) {
      result.push(`${own}が，正解手ほど大きな当たりではない`);
    }
  }
  result.push(...missing);
  return unique(result).slice(0, 6);
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

function naturalButWorseGap(feature?: ChoiceEvalFeature): boolean {
  return feature?.quality === 'worse' ||
    feature?.quality === 'bad' ||
    feature?.quality === 'blunder' ||
    (feature?.gapFromBest !== null && feature?.gapFromBest !== undefined && feature.gapFromBest >= 120);
}

function correctHasStrongerEvidence(params: {
  correctLineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
  missingComparedToCorrect: string[];
}): boolean {
  if (params.missingComparedToCorrect.length > 0) return true;
  return usefulCorrectEvidence(params.correctLineTrajectoryFeatures).some((item) =>
    item.category === 'material' ||
    item.category === 'pieceActivity' ||
    item.category === 'lineContinuation' ||
    item.category === 'threat'
  );
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
  ownStrengths?: string[];
  missingComparedToCorrect?: string[];
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
  const naturalOwnStrengths = (params.ownStrengths ?? []).filter(isUsefulOwnStrengthPhrase);

  if (
    naturalOwnStrengths.length > 0 &&
    naturalButWorseGap(params.feature) &&
    correctHasStrongerEvidence({
      correctLineTrajectoryFeatures: params.correctLineTrajectoryFeatures,
      missingComparedToCorrect: params.missingComparedToCorrect ?? [],
    })
  ) {
    return 'natural_but_worse';
  }

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
  } else if (params.diagnosis === 'natural_but_worse') {
    result.push(`${own ?? '自然に見える'}が，正解手ほど攻めが続かない`);
    result.push(`${own ?? '狙いはある'}が，正解手ほど厳しくない`);
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
    const ownStrengths = unique([
      ...strengthPhrases({
        moveFacts: ownMoveFacts,
        positionFeatures: ownPositionFeatures,
        lineContinuationFeatures: ownLineContinuationFeatures,
      }),
      ...trajectoryStrengthPhrases(ownLineTrajectoryFeatures),
      ...inferredOwnStrengthPhrases({
        moveFacts: ownMoveFacts,
        positionFeatures: ownPositionFeatures,
        lineContinuationFeatures: ownLineContinuationFeatures,
        lineTrajectoryFeatures: ownLineTrajectoryFeatures,
      }),
    ]);
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
      ownStrengths,
      missingComparedToCorrect,
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
    const missingEvidence = feature?.isCorrect
      ? []
      : missingCorrectEvidence({
          correctLineTrajectoryFeatures,
          ownMoveFacts,
          ownPositionFeatures,
          ownLineContinuationFeatures,
          ownLineTrajectoryFeatures,
        });
    const compensatingEvidence = feature?.isCorrect ? [] : ownCompensatingEvidence(ownStrengths);
    const usableContrastPhrases = feature?.isCorrect
      ? []
      : contrastUsablePhrases({
          ownCompensatingEvidence: compensatingEvidence,
          missingCorrectEvidence: missingEvidence,
          contrastPhrases: phrases,
          missingComparedToCorrect,
        });

    return {
      choiceId: choice.choice_id,
      comparedToCorrectChoiceId: correctChoiceId,
      correctStrengths,
      ownStrengths,
      missingComparedToCorrect,
      missingCorrectEvidence: missingEvidence,
      ownCompensatingEvidence: compensatingEvidence,
      contrastUsablePhrases: usableContrastPhrases,
      contrastPhrases: phrases,
      diagnosis,
      confidence: confidence(diagnosis, phrases.length + usableContrastPhrases.length),
    };
  });
}
