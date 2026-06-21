import type { ChoiceEvalFeature, ExplanationPlan, LlmExplanationChoice, LlmExplanationResponse } from './types.js';

export type FallbackExplanationOutput = LlmExplanationResponse & {
  replacedChoiceIds: number[];
  reasonByChoiceId: Record<string, string[]>;
};

function cleanLabel(label: string): string {
  return label.replace(/打$/, '');
}

function plainLabel(label: string): string {
  return cleanLabel(label).replace(/^[▲△]/, '');
}

function firstNonEmpty(...groups: Array<string[] | undefined>): string | null {
  for (const group of groups) {
    const found = group?.find((phrase) => phrase.trim());
    if (found) return found;
  }
  return null;
}

function normalizeMaterialPhrase(phrase: string): string {
  if (phrase === '歩を取れる') return '一歩取れる';
  return phrase;
}

function normalizeContinuationPhrase(phrase: string): string {
  if (phrase === '飛車を逃げても角が成れる') return '飛車を逃げても角成が残る';
  if (phrase === '角が成れる') return '角成が残る';
  return phrase;
}

function normalizeStrengthPhrase(phrase: string): string {
  return normalizeMaterialPhrase(normalizeContinuationPhrase(phrase));
}

function hasConcreteStrength(contrastPhrase: string, strength: string): boolean {
  if (contrastPhrase.includes(strength)) return true;
  if (strength === '一歩取れる' && contrastPhrase.includes('一歩取れる')) return true;
  if (strength.includes('飛車取り') && contrastPhrase.includes('飛車取り')) return true;
  if (strength.includes('角に当たる') && contrastPhrase.includes('角に当たる')) return true;
  if (strength.includes('桂に当たる') && contrastPhrase.includes('桂に当たる')) return true;
  return false;
}

function joinStrengthAndContrast(strength: string, contrastPhrase: string): string {
  const normalizedStrength = normalizeStrengthPhrase(strength);
  const normalizedContrast = normalizeStrengthPhrase(contrastPhrase);
  if (hasConcreteStrength(normalizedContrast, normalizedStrength)) {
    return `${normalizedContrast}。`;
  }
  if (normalizedContrast.startsWith('正解手') || normalizedContrast.startsWith('後続') || normalizedContrast.startsWith('攻め')) {
    return `${normalizedStrength}が，${normalizedContrast}。`;
  }
  return `${normalizedStrength}ものの，${normalizedContrast}。`;
}

function isPawnMove(plan: ExplanationPlan): boolean {
  return plan.sourceSignals.moveFacts?.movedPiece === '歩' || plainLabel(plan.label).includes('歩');
}

export function buildFallbackExplanation(plan: ExplanationPlan, feature: ChoiceEvalFeature): string {
  const label = plainLabel(plan.label);
  const continuation = firstNonEmpty(plan.sourceSignals.lineContinuationFeatures?.continuationPhrases);
  const normalizedContinuation = continuation ? normalizeContinuationPhrase(continuation) : null;
  const moveFact = firstNonEmpty(plan.sourceSignals.moveFacts?.factPhrases);
  const positionPhrase = firstNonEmpty(plan.sourceSignals.positionFeatures?.summaryPhrases);
  const materialPhrase = firstNonEmpty(plan.sourceSignals.positionFeatures?.material.materialPhrases);
  const activityPhrase = firstNonEmpty(plan.sourceSignals.positionFeatures?.pieceActivity.activityPhrases);
  const contrastOwnStrength = firstNonEmpty(plan.sourceSignals.contrastFeatures?.ownStrengths);

  if (plan.isCorrect) {
    const firstPhrase = moveFact ?? positionPhrase ?? materialPhrase ?? activityPhrase ?? contrastOwnStrength;
    if (firstPhrase && normalizedContinuation) {
      return `${firstPhrase}。${normalizedContinuation}。`;
    }
    if (normalizedContinuation) {
      return `${normalizedContinuation}。`;
    }
    if (firstPhrase) {
      return `${firstPhrase}。攻めが続く。`;
    }
    return `${label}は攻めが続く。`;
  }

  const contrastPhrase = firstNonEmpty(plan.sourceSignals.contrastFeatures?.contrastPhrases);
  const ownStrength = contrastOwnStrength ? normalizeStrengthPhrase(contrastOwnStrength) : null;
  if (contrastPhrase) {
    if (ownStrength) {
      return joinStrengthAndContrast(ownStrength, contrastPhrase);
    }
    if (moveFact) {
      return joinStrengthAndContrast(moveFact, contrastPhrase);
    }
    if (positionPhrase) {
      return joinStrengthAndContrast(positionPhrase, contrastPhrase);
    }
    if (materialPhrase) {
      return joinStrengthAndContrast(materialPhrase, contrastPhrase);
    }
    if (activityPhrase) {
      return joinStrengthAndContrast(activityPhrase, contrastPhrase);
    }
    return `${contrastPhrase}。`;
  }

  const safePhrase = firstNonEmpty([ownStrength ?? ''], [moveFact ?? ''], [positionPhrase ?? ''], [materialPhrase ?? ''], [activityPhrase ?? '']);
  if (safePhrase) {
    const normalizedSafePhrase = normalizeStrengthPhrase(safePhrase);
    if (normalizedSafePhrase === '一歩取れる') {
      return '一歩取れるが，正解手ほど攻めが続かない。';
    }
    return `${normalizedSafePhrase}が，攻めとしては少し重い。`;
  }

  if (plan.primaryReason === 'wrong_too_slow' || feature.quality === 'bad' || feature.quality === 'blunder' || isPawnMove(plan)) {
    return `${label}は少し遅い。正解手と比べると攻め味が弱い。`;
  }

  return '正解手と比べると攻め味が弱い。';
}

export function buildFallbackResponse(params: {
  baseOutput: LlmExplanationResponse | null;
  plans: ExplanationPlan[];
  features: ChoiceEvalFeature[];
  fallbackChoiceIds: Set<number>;
  reasonByChoiceId?: Map<number, string[]>;
}): FallbackExplanationOutput {
  const existingByChoiceId = new Map<number, string>();
  for (const choice of params.baseOutput?.choices ?? []) {
    if (typeof choice.choice_id === 'number' && typeof choice.explanation === 'string') {
      existingByChoiceId.set(choice.choice_id, choice.explanation);
    }
  }

  const replacedChoiceIds: number[] = [];
  const reasonByChoiceId: Record<string, string[]> = {};
  const choices: LlmExplanationChoice[] = params.plans
    .slice()
    .sort((a, b) => a.choiceId - b.choiceId)
    .map((plan) => {
      const feature = params.features.find((item) => item.choice_id === plan.choiceId);
      const shouldFallback = params.fallbackChoiceIds.has(plan.choiceId) || !existingByChoiceId.has(plan.choiceId);
      if (shouldFallback || !feature) {
        replacedChoiceIds.push(plan.choiceId);
        reasonByChoiceId[String(plan.choiceId)] = params.reasonByChoiceId?.get(plan.choiceId) ?? ['validation_failed'];
      }
      return {
        choice_id: plan.choiceId,
        explanation: shouldFallback || !feature
          ? buildFallbackExplanation(plan, feature ?? {
              choice_id: plan.choiceId,
              rank: 0,
              gapFromBest: null,
              quality: 'unknown',
              isCorrect: plan.isCorrect,
            })
          : existingByChoiceId.get(plan.choiceId) ?? '',
      };
    });

  return { replacedChoiceIds, reasonByChoiceId, choices };
}
