import type {
  DraftLineContinuationFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblemChoice,
  LlmExplanationResponse,
} from './types.js';

const MAX_EXPLANATION_LENGTH = 240;
const BAD_EXPLANATION_PHRASES = [
  '効果的',
  'おすすめ',
  'お勧め',
  '可能性',
  '可能性があります',
  '効果',
  '圧力',
  '自然な一手',
  '成果が出にくい',
  '対応が必要',
  '狙いが弱く',
  'この手を無視できない',
  '反撃',
  '優勢',
  '有利',
  '形勢',
  '評価が良い',
  '保てる',
  '勝ちやすい',
];

export type ExplanationValidationIssueCode =
  | 'missing_choice'
  | 'duplicate_choice'
  | 'invalid_choice_id'
  | 'too_short'
  | 'too_long'
  | 'too_many_sentences'
  | 'bad_phrase'
  | 'unsupported_escape_phrase'
  | 'unsupported_risk_phrase'
  | 'missing_required_continuation_phrase';

export type ExplanationValidationIssue = {
  code: ExplanationValidationIssueCode;
  choiceId?: number;
  message: string;
};

export class ExplanationValidationError extends Error {
  readonly issues: ExplanationValidationIssue[];

  constructor(issues: ExplanationValidationIssue[]) {
    super(issues[0]?.message ?? 'LLM output validation failed');
    this.name = 'ExplanationValidationError';
    this.issues = issues;
  }
}

export type ExplanationValidationContext = {
  moveFactsList?: DraftMoveFacts[];
  positionFeaturesList?: DraftPositionFeatures[];
  lineContinuationFeaturesList?: DraftLineContinuationFeatures[];
  requiredContinuationChoiceIds?: number[];
};

function hasEscapeEvidence(
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

function sentenceCount(text: string): number {
  const sentences = text
    .split('。')
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length;
}

function hasKingSafetyEvidence(positionFeatures: DraftPositionFeatures | undefined): boolean {
  return Boolean(
    positionFeatures?.kingSafety.confidence === 'medium' &&
    positionFeatures.kingSafety.kingSafetyPhrases.some((phrase) => phrase.trim()),
  );
}

function hasContinuationPhraseEvidence(
  explanation: string,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  const continuationPhrases = lineContinuationFeatures?.continuationPhrases ?? [];
  const nextOwnMoveFacts = lineContinuationFeatures?.nextOwnMoveFacts ?? [];
  const candidates = [...continuationPhrases, ...nextOwnMoveFacts].filter((phrase) => phrase.trim());
  if (candidates.some((phrase) => explanation.includes(phrase))) return true;

  if (
    candidates.some((phrase) => phrase.includes('角が成れる') || phrase.includes('角成')) &&
    (explanation.includes('角成') || explanation.includes('角が成'))
  ) {
    return true;
  }

  if (
    candidates.some((phrase) => phrase.includes('馬を作れる')) &&
    explanation.includes('馬を作')
  ) {
    return true;
  }

  if (
    candidates.some((phrase) => phrase.includes('龍を作れる')) &&
    explanation.includes('龍を作')
  ) {
    return true;
  }

  return false;
}

export function validateExplanations(
  value: LlmExplanationResponse,
  inputChoices: DraftProblemChoice[],
  context: ExplanationValidationContext = {},
): LlmExplanationResponse {
  if (!value || !Array.isArray(value.choices)) {
    throw new ExplanationValidationError([{
      code: 'missing_choice',
      message: 'LLM output choices must be an array',
    }]);
  }

  const expectedChoiceIds = new Set(inputChoices.map((choice) => choice.choice_id));
  const moveFactsByChoiceId = new Map((context.moveFactsList ?? []).map((facts) => [facts.choiceId, facts]));
  const positionFeaturesByChoiceId = new Map(
    (context.positionFeaturesList ?? []).map((features) => [features.choiceId, features]),
  );
  const lineContinuationByChoiceId = new Map(
    (context.lineContinuationFeaturesList ?? []).map((facts) => [facts.choiceId, facts]),
  );
  const requiredContinuationChoiceIds = new Set(context.requiredContinuationChoiceIds ?? []);
  const actualChoiceIds = new Set<number>();
  const issues: ExplanationValidationIssue[] = [];

  for (const choice of value.choices) {
    if (!choice || typeof choice.choice_id !== 'number' || !Number.isInteger(choice.choice_id)) {
      issues.push({
        code: 'invalid_choice_id',
        message: 'LLM output contains invalid choice_id',
      });
      continue;
    }
    if (!expectedChoiceIds.has(choice.choice_id)) {
      issues.push({
        code: 'invalid_choice_id',
        choiceId: choice.choice_id,
        message: `LLM output contains unknown choice_id=${choice.choice_id}`,
      });
      continue;
    }
    if (actualChoiceIds.has(choice.choice_id)) {
      issues.push({
        code: 'duplicate_choice',
        choiceId: choice.choice_id,
        message: `LLM output contains duplicate choice_id=${choice.choice_id}`,
      });
      continue;
    }
    if (typeof choice.explanation !== 'string' || !choice.explanation.trim()) {
      issues.push({
        code: 'too_short',
        choiceId: choice.choice_id,
        message: `LLM output explanation is empty for choice_id=${choice.choice_id}`,
      });
    }
    if (typeof choice.explanation === 'string' && choice.explanation.length > MAX_EXPLANATION_LENGTH) {
      issues.push({
        code: 'too_long',
        choiceId: choice.choice_id,
        message: `LLM output explanation is too long for choice_id=${choice.choice_id}`,
      });
    }
    const explanation = typeof choice.explanation === 'string' ? choice.explanation : '';
    if (sentenceCount(explanation) > 2) {
      issues.push({
        code: 'too_many_sentences',
        choiceId: choice.choice_id,
        message: `LLM output explanation has too many sentences for choice_id=${choice.choice_id}`,
      });
    }
    const badPhrase = BAD_EXPLANATION_PHRASES.find((phrase) => explanation.includes(phrase));
    if (badPhrase) {
      issues.push({
        code: 'bad_phrase',
        choiceId: choice.choice_id,
        message: `LLM output contains banned phrase "${badPhrase}" for choice_id=${choice.choice_id}`,
      });
    }
    if (
      (explanation.includes('逃げられる') || explanation.includes('かわされる')) &&
      !hasEscapeEvidence(moveFactsByChoiceId.get(choice.choice_id), lineContinuationByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'unsupported_escape_phrase',
        choiceId: choice.choice_id,
        message: `LLM output mentions escape without move_facts evidence for choice_id=${choice.choice_id}`,
      });
    }
    if (
      (explanation.includes('危険') || explanation.includes('危ない')) &&
      !hasKingSafetyEvidence(positionFeaturesByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'unsupported_risk_phrase',
        choiceId: choice.choice_id,
        message: `LLM output mentions king risk without position_features evidence for choice_id=${choice.choice_id}`,
      });
    }
    if (
      requiredContinuationChoiceIds.has(choice.choice_id) &&
      !hasContinuationPhraseEvidence(explanation, lineContinuationByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'missing_required_continuation_phrase',
        choiceId: choice.choice_id,
        message: `LLM output does not use required line_continuation_features for choice_id=${choice.choice_id}`,
      });
    }
    actualChoiceIds.add(choice.choice_id);
  }

  if (actualChoiceIds.size !== expectedChoiceIds.size) {
    issues.push({
      code: 'missing_choice',
      message: 'LLM output choice_id set does not match input choices',
    });
  }

  for (const expectedChoiceId of expectedChoiceIds) {
    if (!actualChoiceIds.has(expectedChoiceId)) {
      issues.push({
        code: 'missing_choice',
        choiceId: expectedChoiceId,
        message: `LLM output is missing choice_id=${expectedChoiceId}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new ExplanationValidationError(issues);
  }

  return {
    choices: value.choices.map((choice) => ({
      choice_id: choice.choice_id,
      explanation: choice.explanation.trim(),
    })),
  };
}
