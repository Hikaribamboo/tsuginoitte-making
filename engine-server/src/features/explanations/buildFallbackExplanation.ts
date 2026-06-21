import type { ChoiceEvalFeature, ExplanationPlan, LlmExplanationChoice, LlmExplanationResponse } from './types.js';

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

function isPawnMove(plan: ExplanationPlan): boolean {
  return plan.sourceSignals.moveFacts?.movedPiece === '歩' || plainLabel(plan.label).includes('歩');
}

export function buildFallbackExplanation(plan: ExplanationPlan, feature: ChoiceEvalFeature): string {
  const label = plainLabel(plan.label);
  const continuation = firstNonEmpty(plan.sourceSignals.lineContinuationFeatures?.continuationPhrases);
  const normalizedContinuation = continuation ? normalizeContinuationPhrase(continuation) : null;
  const moveFact = firstNonEmpty(plan.sourceSignals.moveFacts?.factPhrases);
  const positionPhrase = firstNonEmpty(plan.sourceSignals.positionFeatures?.summaryPhrases);

  if (plan.isCorrect) {
    const firstPhrase = moveFact ?? positionPhrase;
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
  if (contrastPhrase) {
    return `${contrastPhrase}。`;
  }

  const safePhrase = positionPhrase ? normalizeMaterialPhrase(positionPhrase) : null;
  if (safePhrase) {
    if (safePhrase === '一歩取れる') {
      return '一歩取れるが，正解手ほど攻めが続かない。';
    }
    return `${safePhrase}が，攻めとしては少し重い。`;
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
}): LlmExplanationResponse {
  const existingByChoiceId = new Map<number, string>();
  for (const choice of params.baseOutput?.choices ?? []) {
    if (typeof choice.choice_id === 'number' && typeof choice.explanation === 'string') {
      existingByChoiceId.set(choice.choice_id, choice.explanation);
    }
  }

  const choices: LlmExplanationChoice[] = params.plans
    .slice()
    .sort((a, b) => a.choiceId - b.choiceId)
    .map((plan) => {
      const feature = params.features.find((item) => item.choice_id === plan.choiceId);
      const shouldFallback = params.fallbackChoiceIds.has(plan.choiceId) || !existingByChoiceId.has(plan.choiceId);
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

  return { choices };
}
